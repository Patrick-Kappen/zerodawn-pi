/**
 * Checker: asks a classifier, before pi settles, whether the agent really finished.
 *
 * On agent_before_settle it builds a state of the run since the last user message
 * and asks all questions in one classify() call. Fixed thresholds in decide() turn the
 * answers into reasons. With a reason, a hidden message asks the agent for one more turn.
 * At most MAX_FOLLOWUPS per user message. Every check goes to the session and to a JSONL log.
 *
 * Env:
 *   PI_CHECKER_CLASSIFIER  classifier model as provider/model (default typesafe/Decision-1)
 *   PI_CHECKER_LOG         JSONL log file (default ~/.pi/agent/checker.jsonl)
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CLASSIFIER = (process.env.PI_CHECKER_CLASSIFIER ?? "typesafe/Decision-1").split("/") as [string, string];
const LOG = process.env.PI_CHECKER_LOG ?? join(homedir(), ".pi", "agent", "checker.jsonl");
export const MAX_FOLLOWUPS = 3;
export const FOLLOWUP_TYPE = "checker-followup";
const EDIT_TOOLS = new Set(["edit", "write"]);
export const BACKGROUND_JOBS_QUERY = "bash:background-jobs";

/** The bash extension answers synchronously; without it nothing answers and the result is false. */
export function backgroundJobRunning(pi: Pick<ExtensionAPI, "events">) {
  const query = { running: false };
  pi.events.emit(BACKGROUND_JOBS_QUERY, query);
  return query.running;
}

export const clip = (v: unknown, n: number) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const text = (content: unknown) =>
  Array.isArray(content)
    ? content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
    : String(content ?? "");

const isCheck = (name: string, args: any) => name === "run_tests" || (name === "bash" && /\bjust (check|test|lint|types)\b/.test(String(args?.command ?? "")));

/** State of the run since the last user message, from session branch entries. */
export function buildState(entries: any[]) {
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "message" && entries[i].message.role === "user") {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;
  const run = entries.slice(start + 1);
  const calls = new Map<string, { name: string; args: any }>();
  const toolErrors: { tool: string; text: string }[] = [];
  const edits = new Set<string>();
  const toolsUsed: Record<string, number> = {};
  let checksAfterLastEdit: { tool: string; failed: boolean }[] = [];
  let finalAnswer = "";
  let followups = 0;
  for (const e of run) {
    if (e.type === "custom_message" && e.customType === FOLLOWUP_TYPE) followups++;
    if (e.type !== "message") continue;
    const m = e.message;
    if (m.role === "assistant") {
      const t = text(m.content);
      if (t.trim()) finalAnswer = t;
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type !== "toolCall") continue;
        calls.set(c.id, { name: c.name, args: c.arguments });
        toolsUsed[c.name] = (toolsUsed[c.name] ?? 0) + 1;
      }
    } else if (m.role === "toolResult") {
      const call = calls.get(m.toolCallId);
      const name = call?.name ?? m.toolName;
      if (m.isError) toolErrors.push({ tool: name, text: clip(text(m.content), 600) });
      if (EDIT_TOOLS.has(name) && !m.isError) {
        if (call?.args?.path) edits.add(String(call.args.path));
        checksAfterLastEdit = [];
      }
      if (isCheck(name, call?.args)) checksAfterLastEdit.push({ tool: name, failed: !!m.isError });
    }
  }
  return {
    request: clip(text(entries[start].message.content), 4000),
    finalAnswer: clip(finalAnswer, 6000),
    toolErrors: toolErrors.slice(-8),
    edits: [...edits],
    checksAfterLastEdit,
    toolsUsed,
    followupsUsed: followups,
  };
}

export type State = NonNullable<ReturnType<typeof buildState>>;

export const QUESTIONS = {
  status: {
    type: "choice",
    instructions: "A coding agent ended its turn with finalAnswer for the user's request. What is the state of the work?",
    criteria: {
      done: "The request is fully handled and the answer reports the result.",
      incomplete: "Parts of the request are not done, or the answer stops halfway.",
      blocked: "The agent cannot continue without something outside its reach: access, a decision of the user, a missing service.",
      question: "The answer ends with a question to the user.",
    },
  },
  open_error: {
    type: "bool",
    instructions: "Does finalAnswer or toolErrors show an error, bug or failing check that the agent did not fix?",
    criteria: { true: "An error stays unfixed.", false: "No unfixed error." },
  },
  in_scope: {
    type: "bool",
    instructions: "If an error or open point stays, is fixing it part of the request or of normal project rules (tests, lint, types)?",
    criteria: { true: "Fixing it belongs to the task.", false: "It is outside the task, or nothing stays open." },
  },
  question_answerable: {
    type: "bool",
    instructions: "If finalAnswer asks the user a question, can the agent find the answer itself by reading code, docs or running tools?",
    criteria: { true: "The agent can find it itself.", false: "Only the user knows it, or there is no question." },
  },
  verified: {
    type: "bool",
    instructions: "If the agent changed files (edits), did it run tests or checks after the last change and did they pass (checksAfterLastEdit)?",
    criteria: { true: "Verified after the last change, or no files changed.", false: "Files changed without a passing check afterwards." },
  },
  completeness: {
    type: "score",
    instructions: "How completely does finalAnswer handle the request?",
    criteria: ["Barely started", "Partly done", "Mostly done, small gaps", "Fully done"],
  },
  rule_violation: {
    type: "bool",
    instructions: "Did the agent do work outside the request, such as unrelated changes or actions the user did not ask for?",
    criteria: { true: "It did work outside the request.", false: "It stayed inside the request." },
  },
} as const;

type Answers = Record<string, any>;

/** Reasons for one more turn; empty means settle. rule_violation is only logged. */
export function decide(a: Answers, state: State): string[] {
  const reasons: string[] = [];
  const p = (id: string) => (a[id]?.type === "bool" ? a[id].probability : 0);
  if (p("open_error") > 0.7 && p("in_scope") > 0.6) reasons.push("You reported or left an error inside the scope of the task. Fix it.");
  if (a.status?.choice === "question" && p("question_answerable") > 0.7)
    reasons.push("You asked the user a question that you can answer yourself with code, docs or tools. Find the answer.");
  if (state.edits.length > 0 && p("verified") < 0.3) reasons.push("You changed files without a passing test or check after the last change. Run them.");
  if ((a.status?.choice === "incomplete" && a.status.confidence > 0.7) || (a.completeness?.type === "score" && a.completeness.score <= 1))
    reasons.push("The task is not complete. Finish it.");
  return reasons;
}

export function followupText(reasons: string[]) {
  return `Automatic check before you finish:\n${reasons.map((r) => `- ${r}`).join("\n")}\nIf a point is wrong, say why in one sentence and finish.`;
}

function log(record: unknown) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, `${JSON.stringify(record)}\n`);
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_before_settle", async (event, ctx: ExtensionContext) => {
    if (event.outcome !== "completed" || event.continue || !event.context.canContinue) return;
    if (backgroundJobRunning(pi)) return;
    const state = buildState(ctx.sessionManager.getBranch() as any[]);
    if (!state) return;
    const model = ctx.modelRegistry.findOfType("classifier", ...CLASSIFIER);
    if (!model) {
      ctx.ui.notify(`checker: classifier ${CLASSIFIER.join("/")} not found; set PI_CHECKER_CLASSIFIER or add the model.`, "warning");
      return;
    }
    const res = await ctx.modelRegistry.classify(model, { state, questions: QUESTIONS as any });
    if (res.stopReason !== "stop") {
      ctx.ui.notify(`checker: classify with ${CLASSIFIER.join("/")} failed (${res.stopReason}): ${res.errorMessage ?? "no message"}`, "warning");
      log({ at: new Date().toISOString(), session: ctx.sessionManager.getSessionId(), state, error: res.errorMessage });
      return;
    }
    const reasons = decide(res.answers, state);
    const followup = reasons.length > 0 && state.followupsUsed < MAX_FOLLOWUPS;
    const record = { at: new Date().toISOString(), session: ctx.sessionManager.getSessionId(), state, answers: res.answers, reasons, followup };
    log(record);
    const entries = [...event.entries, { type: "custom" as const, customType: "checker", data: { answers: res.answers, reasons, followup } }];
    if (!followup) {
      if (reasons.length > 0) ctx.ui.notify(`checker: limit of ${MAX_FOLLOWUPS} follow-ups reached; open: ${reasons.length} point(s).`, "warning");
      return { entries };
    }
    ctx.ui.notify(`checker: follow-up ${state.followupsUsed + 1}/${MAX_FOLLOWUPS} (${reasons.length} point(s))`, "info");
    entries.push({ type: "custom_message" as const, customType: FOLLOWUP_TYPE, content: followupText(reasons), display: false } as any);
    return { entries, continue: true };
  });
}
