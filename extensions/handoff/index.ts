import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handoffModels } from "../../shared/config.ts";
import { sessionDir } from "../../shared/store.ts";
import { render } from "./lib/card.ts";
import { gitFacts, jobFacts } from "./lib/facts.ts";
import { type Handoff, lastHandoff, saveHandoff } from "./lib/store.ts";
import { type Registry, writeCard } from "./lib/summarize.ts";
import { type Entry, strip, tail } from "./lib/transcript.ts";

export const RECENT_MAX_CHARS = 6_000;
const USAGE = "Usage: /handoff (a new session with the handoff) | /handoff card (update the card only)";

export async function buildHandoff(ctx: ExtensionCommandContext, ladder: string[]): Promise<{ handoff: Handoff; path: string }> {
  const dir = sessionDir(ctx);
  const previous = lastHandoff(dir);
  const branch = ctx.sessionManager.getBranch() as Entry[];
  const since = previous ? branch.findIndex((e) => e.id === previous.untilEntry) + 1 : 0;
  const lines = strip(branch.slice(since));
  const { card, model } = await writeCard(ctx.modelRegistry as unknown as Registry, ladder, previous?.card, lines, ctx.signal);
  const facts = [...gitFacts(ctx.cwd), ...jobFacts(dir)];
  const recent = tail(strip(branch), RECENT_MAX_CHARS);
  const source = `${ctx.sessionManager.getSessionFile()} (entries up to ${branch.at(-1)?.id})`;
  const handoff: Handoff = {
    card,
    model,
    facts,
    recent,
    text: render(card, facts, recent, source),
    untilEntry: branch.at(-1)?.id ?? "",
    createdAt: new Date().toISOString(),
  };
  return { handoff, path: saveHandoff(dir, handoff) };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff", {
    description: "Write the handoff card and start a new session with it; /handoff card only updates the card",
    getArgumentCompletions: (prefix) => ["card"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const verb = args.trim();
      if (verb !== "" && verb !== "card") throw new Error(`/handoff: unknown argument "${verb}". ${USAGE}`);
      await ctx.waitForIdle();
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
