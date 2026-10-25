import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { prunedChars, selectEdits } from "./select.ts";

export default function (pi: ExtensionAPI) {
  let saved = 0;
  pi.on("session_start", () => {
    saved = 0;
  });
  pi.on("turn_end", (event, ctx) => {
    const branch = ctx.sessionManager.getBranch() as Parameters<typeof selectEdits>[0];
    const edits = selectEdits(branch);
    if (!edits.length) return;
    saved += prunedChars(branch, edits);
    if (ctx.hasUI) ctx.ui.setStatus("prune", ctx.ui.theme.fg("dim", `✂ ${Math.round(saved / 1024)} KB`));
    return { entries: [...((event as { entries?: unknown[] }).entries ?? []), ...edits.map((e) => ({ type: "context_edit" as const, ...e }))] };
  });
}
