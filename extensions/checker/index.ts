/**
 * Checker: asks a classifier, before pi settles, whether the agent really finished.
 *
 * On agent_before_settle it builds a state from the last user message, the agent message before it,
 * and the final answer, and asks all questions in one classify() call. Fixed thresholds in decide() turn the
 * answers into reasons. With a reason, a hidden message asks the agent for one more turn.
 * At most MAX_FOLLOWUPS per user message; tool calls do not reset the count. A follow-up answers only
 * with text and no tool call is a rebuttal, so the checker stops. Every check goes to the session and to a JSONL log.
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

const isFollowup = (e: any) => e.type === "custom_message" && e.customType === FOLLOWUP_TYPE;

/** Reasons listed in a follow-up message, in the format of followupText(). */
export function followupReasons(content: unknown): string[] {
  return text(content)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

/** Reasons that no earlier follow-up of this user message already sent. */
export function newReasons(reasons: string[], sentReasons: string[]) {
  return reasons.filter((reason) => !sentReasons.includes(reason));
}

/** A text-only answer after a follow-up ends the check. */
export function shouldSkip(state: { rebutted: boolean }) {
  return state.rebutted;
}

const lastText = (entries: any[]) => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type !== "message" || e.message.role !== "assistant") continue;
    const t = text(e.message.content);
    if (t.trim()) return t;
  }
  return "";
};

/** The end of a long text, where an answer puts its question or offer. */
export const clipEnd = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);

/**
 * State of the run since the last user message, from session branch entries.
 * Only the request and the answers go in: the checker judges what the agent says is open, not the tool log.
 */
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
  let firstFollowup = -1;
  let lastFollowup = -1;
  let followups = 0;
  const sentReasons: string[] = [];
  for (let i = 0; i < run.length; i++) {
    const e = run[i];
    if (isFollowup(e)) {
      if (firstFollowup < 0) firstFollowup = i;
      lastFollowup = i;
      followups++;
      for (const reason of followupReasons(e.content)) if (!sentReasons.includes(reason)) sentReasons.push(reason);
    }
  }
  let finalAnswer = "";
  let rebuttal = "";
  let toolCallsAfterFollowup = 0;
  for (let i = 0; i < run.length; i++) {
    const e = run[i];
    if (e.type !== "message") continue;
    const m = e.message;
    if (m.role !== "assistant") continue;
    const t = text(m.content);
    if (firstFollowup < 0 || i < firstFollowup) {
      if (t.trim()) finalAnswer = t;
    }
    if (lastFollowup >= 0 && i > lastFollowup) {
      if (t.trim()) rebuttal = t;
      for (const c of Array.isArray(m.content) ? m.content : []) if (c.type === "toolCall") toolCallsAfterFollowup++;
    }
  }
  return {
    previousAnswer: clipEnd(lastText(entries.slice(0, start)), 3000),
    request: clip(text(entries[start].message.content), 4000),
    finalAnswer: clip(finalAnswer, 6000),
    rebuttal: clip(rebuttal, 6000),
    followupsUsed: followups,
    sentReasons,
    rebutted: lastFollowup >= 0 && toolCallsAfterFollowup === 0 && rebuttal.trim().length > 0,
  };
}

const NEEDS_USER =
  "A merge, push, release, rebuild, restart, reboot, a manual test in a GUI or on hardware, access, or a choice between options needs the user. Work that the answer hands to a next session needs the user.";

export const QUESTIONS = {
  open_point: {
    type: "bool",
    instructions:
      "A coding agent ended its turn with finalAnswer to the user's request. previousAnswer is the agent message that request replies to. Does finalAnswer name a point that stays open: a part of the request that is not done, an error that is not fixed, a check that is not done, a next step that it offers, or a step that it announces (for example 'first I look at X') but did not do?",
    criteria: { true: "finalAnswer names an open point.", false: "finalAnswer names no open point." },
  },
  in_request: {
    type: "bool",
    instructions:
      "If finalAnswer names an open point, did the user ask for that work in request (read request together with previousAnswer)? A side finding, a defect outside the request, an unrelated failing test, or an improvement that the user did not ask for is not part of the request. When request is a question, an answer to the question completes it.",
    criteria: { true: "The open point is work that the user asked for.", false: "The open point is outside the request, or no point stays open." },
  },
  agent_can_do: {
    type: "bool",
    instructions: `If finalAnswer names an open point, can the agent close it now with its own tools (read files, logs or code, run commands, edit files), without an answer or action of the user? A step that the agent announced and can start with its tools needs no user. ${NEEDS_USER}`,
    criteria: { true: "The agent can close the point now without the user.", false: "The point needs the user, or no point stays open." },
  },
  question_answerable: {
    type: "bool",
    instructions:
      "Is the last sentence of finalAnswer a question from the agent to the user, and can the agent find its answer itself by reading code, docs or logs, or by running tools? The request is not this question. A question about what the user wants, or whether to do work outside the request, needs the user.",
    criteria: {
      true: "finalAnswer ends with a question that the agent can answer itself.",
      false: "finalAnswer does not end with a question, or only the user knows the answer.",
    },
  },
} as const;

type Answers = Record<string, any>;

export const REASONS = {
  open: "Close the open point of the request. You can do it without the user.",
  question: "Find the answer to your question yourself.",
};

/** Reasons for one more turn; empty means settle. Only work inside the request that needs no user sends the agent back. */
export function decide(a: Answers): string[] {
  const reasons: string[] = [];
  const p = (id: string) => (a[id]?.type === "bool" ? a[id].probability : 0);
  if (p("in_request") <= 0.7) return reasons;
  if (p("open_point") > 0.7 && p("agent_can_do") > 0.7) reasons.push(REASONS.open);
  if (p("question_answerable") > 0.7) reasons.push(REASONS.question);
  return reasons;
}

export function followupText(reasons: string[]) {
  return `checker:\n${reasons.map((r) => `- ${r}`).join("\n")}\nIf wrong, say why in one sentence.`;
}

function log(record: unknown) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, `${JSON.stringify(record)}\n`);
}

/** context.canContinue is false when the run ends on assistant text; the follow-up message makes the continuation valid. */
export function shouldCheck(event: { outcome: string; continue?: boolean }) {
  return event.outcome === "completed" && !event.continue;
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_before_settle", async (event, ctx: ExtensionContext) => {
    if (!shouldCheck(event)) return;
    if (backgroundJobRunning(pi)) return;
    const state = buildState(ctx.sessionManager.getBranch() as any[]);
    if (!state) return;
    if (shouldSkip(state)) return;
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
    const reasons = newReasons(decide(res.answers), state.sentReasons);
    const followup = reasons.length > 0 && state.followupsUsed < MAX_FOLLOWUPS;
    const record = { at: new Date().toISOString(), session: ctx.sessionManager.getSessionId(), state, answers: res.answers, reasons, followup };
    log(record);
    const entries = [...event.entries, { type: "custom" as const, customType: "checker", data: { answers: res.answers, reasons, followup } }];
    if (!followup) {
      if (reasons.length > 0) ctx.ui.notify(`checker: limit of ${MAX_FOLLOWUPS} follow-ups reached; open: ${reasons.length} point(s).`, "warning");
      return { entries };
    }
    entries.push({ type: "custom_message" as const, customType: FOLLOWUP_TYPE, content: followupText(reasons), display: false } as any);
    return { entries, continue: true };
  });
}
