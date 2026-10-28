import type { ExtensionAPI, ExtensionContext, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { handoffModels } from "../../shared/config.ts";
import { sessionDir } from "../../shared/store.ts";
import { render } from "./lib/card.ts";
import { type Boundary, decide, RESUME, warmDecision, warning } from "./lib/decider.ts";
import { gitFacts, jobFacts, jobsRunning, systemFacts } from "./lib/facts.ts";
import { ask, RECALL_MAX_CHARS, RECALL_TEXT_MAX, readSession, select } from "./lib/recall.ts";
import { type Handoff, lastHandoff, saveHandoff } from "./lib/store.ts";
import { type Registry, writeCard } from "./lib/summarize.ts";
import { type Entry, strip } from "./lib/transcript.ts";
import { updateReasons } from "./lib/triggers.ts";

const USAGE = "Usage: /handoff (a new session with the handoff) | /handoff card (update the card only)";

export function sinceLastCard(ctx: ExtensionContext) {
  const dir = sessionDir(ctx);
  const previous = lastHandoff(dir);
  const branch = ctx.sessionManager.getBranch() as Entry[];
  const fresh = branch.slice(previous ? branch.findIndex((e) => e.id === previous.untilEntry) + 1 : 0);
  return { dir, previous, branch, fresh, lines: strip(fresh) };
}

export async function buildHandoff(ctx: ExtensionContext, ladder: string[]): Promise<{ handoff: Handoff; path: string }> {
  const { dir, previous, branch, lines } = sinceLastCard(ctx);
  const facts = [...systemFacts(), ...gitFacts(ctx.cwd), ...jobFacts(dir)];
  const { card, model } = await writeCard(ctx.modelRegistry as unknown as Registry, ladder, previous?.card, facts, lines, ctx.signal);
  const source = `${ctx.sessionManager.getSessionFile()} (entries up to ${branch.at(-1)?.id})`;
  const handoff: Handoff = {
    card,
    model,
    facts,
    text: render(card, facts, source),
    untilEntry: branch.at(-1)?.id ?? "",
    createdAt: new Date().toISOString(),
  };
  return { handoff, path: saveHandoff(dir, handoff) };
}

type BoundaryEvent = { entries: SessionBoundaryDraft[]; continue: boolean };

export function lastAnswerId(branch: Entry[]): string | undefined {
  return branch.findLast((e) => e.type === "message" && e.message?.role === "assistant")?.id;
}

export default function (pi: ExtensionAPI) {
  let running: Promise<unknown> | undefined;
  let latest: { handoff: Handoff; path: string } | undefined;
  const update = (ctx: ExtensionContext, why: string) => {
    running = buildHandoff(ctx, handoffModels())
      .then((built) => {
        latest = built;
        ctx.ui.notify(`handoff: card updated (${why}) by ${built.handoff.model}: ${built.path}`, "info");
      })
      .catch((err) => ctx.ui.notify(`handoff: the card update (${why}) failed: ${(err as Error).message}`, "error"))
      .finally(() => {
        running = undefined;
      });
    return running;
  };

  let warned = 0;
  let requested = false;
  const boundary = async (ctx: ExtensionContext, at: Boundary, event: BoundaryEvent, toolCalls: boolean) => {
    const tokens = ctx.getContextUsage()?.tokens;
    if (tokens === undefined || tokens === null) return undefined;
    const jobs = jobsRunning(sessionDir(ctx));
    const decision = decide(tokens, at, warned, jobs, toolCalls, requested);
    if (decision.action === "warn") {
      warned = decision.level;
      return { entries: [...event.entries, { type: "custom_message" as const, customType: "handoff-warning", content: warning(tokens), display: true }] };
    }
    if (decision.action !== "cut") return undefined;
    if (running) await running;
    const branch = ctx.sessionManager.getBranch() as Entry[];
    const { handoff, path } = latest && latest.handoff.untilEntry === branch.at(-1)?.id ? latest : await buildHandoff(ctx, handoffModels());
    warned = 0;
    requested = false;
    ctx.ui.notify(`handoff: ${decision.why}; the context is now the handoff (${path}).`, "warning");
    if (at === "settle") {
      const keep = lastAnswerId(branch) ?? null;
      const cut = { type: "compaction" as const, summary: handoff.text, firstKeptEntryId: keep, details: { path } };
      return { entries: [...event.entries, cut], continue: event.continue };
    }
    const cut = { type: "compaction" as const, summary: handoff.text, firstKeptEntryId: null, details: { path } };
    const resume = { type: "custom_message" as const, customType: "handoff-resume", content: RESUME, display: true };
    return { entries: [...event.entries, cut, resume], continue: true };
  };

  pi.on("turn_end", (event, ctx) => boundary(ctx, "turn_end", event, event.toolResults.length > 0));
  pi.on("agent_before_settle", (event, ctx) => boundary(ctx, "settle", event, false));
  pi.on("session_start", () => {
    warned = 0;
    requested = false;
    latest = undefined;
  });
  pi.on("cache_warming_decision", (_event, ctx) => {
    const tokens = ctx.getContextUsage()?.tokens;
    const action = tokens ? warmDecision(tokens, jobsRunning(sessionDir(ctx))) : undefined;
    return action ? { action } : undefined;
  });

  pi.on("agent_end", (_event, ctx) => {
    if (running) return;
    const { fresh, lines } = sinceLastCard(ctx);
    const reasons = updateReasons(fresh, lines);
    if (reasons.length) void update(ctx, reasons.join(", "));
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason !== "quit" && event.reason !== "new") return;
    if (running) await running;
    if (sinceLastCard(ctx).lines.length) await update(ctx, `/${event.reason}`);
  });

  pi.registerTool({
    name: "recall",
    label: "recall",
    description: `Answer one question about earlier work of a session, also the part before a handoff, without reading the session yourself. A cheap model reads the stripped transcript (text and one line per tool call) and answers in a few lines with entry ids. Use it when the handoff or your context lacks a detail: a reason, an error, a command, a decision. Returns "Not in the transcript." when the session does not hold the answer.`,
    parameters: Type.Object({
      question: Type.String({ description: "One concrete question, for example: why did we drop the job:<id> paths?" }),
      session: Type.Optional(
        Type.String({ description: "Path of a .jsonl session file, for example the one under Earlier work in a handoff. Default: this session." }),
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const path = params.session ?? ctx.sessionManager.getSessionFile();
      if (!path) throw new Error("recall: this session has no session file. Give the path of a .jsonl session file in session.");
      const lines = select(strip(readSession(path), { ids: true, textMax: RECALL_TEXT_MAX }), params.question, RECALL_MAX_CHARS);
      const { answer, model } = await ask(ctx.modelRegistry as unknown as Registry, handoffModels(), params.question, lines, signal);
      return { content: [{ type: "text", text: answer }], details: { model, session: path, lines: lines.length } };
    },
  });

  pi.registerTool({
    name: "handoff",
    label: "handoff",
    description: "Hand off early: at the end of this turn a handoff replaces the context, and you continue from it.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      requested = true;
      const when = jobsRunning(sessionDir(ctx)) ? "after the running bash jobs end" : "at the end of this turn";
      return { content: [{ type: "text", text: `The handoff comes ${when}.` }], details: {} };
    },
  });

  pi.registerCommand("handoff", {
    description: "Write the handoff card and start a new session with it; /handoff card only updates the card",
    getArgumentCompletions: (prefix) => ["card"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const verb = args.trim();
      if (verb !== "" && verb !== "card") throw new Error(`/handoff: unknown argument "${verb}". ${USAGE}`);
      await ctx.waitForIdle();
      if (running) await running;
      const { handoff, path } = await buildHandoff(ctx, handoffModels());
      if (verb === "card") {
        ctx.ui.notify(`Handoff card by ${handoff.model}: ${path}\n\n${handoff.text}`, "info");
        return;
      }
      const parent = ctx.sessionManager.getSessionFile();
      const result = await ctx.newSession({
        parentSession: parent,
        withSession: async (next) => {
          await next.sendMessage({ customType: "handoff", content: handoff.text, display: true, details: { path } });
        },
      });
      if (result.cancelled) ctx.ui.notify(`/handoff: the new session was cancelled. The handoff is in ${path}.`, "warning");
    },
  });
}
