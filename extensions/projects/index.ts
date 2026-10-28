import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runConfirmation } from "@narumitw/pi-tui-kit";
import type { Run } from "../../shared/pair.ts";
import { loadItems, newWorktree, removeWorktree, switchTo } from "./lib/actions.ts";
import { pick } from "./lib/picker.ts";

export default function (pi: ExtensionAPI) {
  const open = async (ctx: ExtensionContext) => {
    const run: Run = async (command, args) => {
      const r = await pi.exec(command, args, { cwd: ctx.cwd });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr };
    };
    try {
      for (;;) {
        const outcome = await pick(ctx, await loadItems(run));
        if (outcome.kind === "cancel") return;
        if (outcome.kind === "select") return await switchTo(run, process.env.TMUX_PANE, outcome.path);
        if (outcome.kind === "new") {
          const name = await ctx.ui.input("New worktree: branch name", "feature-x");
          if (name) return await switchTo(run, process.env.TMUX_PANE, await newWorktree(run, name));
          continue;
        }
        if (outcome.item.agent) {
          const answer = await runConfirmation(ctx, {
            title: `pi runs in ${outcome.item.label}`,
            message: "Remove the worktree and close its window?",
            confirmLabel: "Remove",
            cancelLabel: "Keep",
          });
          if (answer.kind !== "confirmed") continue;
        }
        await removeWorktree(run, outcome.item);
        ctx.ui.notify(`Removed worktree ${outcome.item.path}`, "info");
      }
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  pi.registerCommand("switch", { description: "Pick a project or worktree and switch the tmux/nvim pair to it", handler: (_args, ctx) => open(ctx) });
  pi.registerShortcut("alt+p", { description: "Switch project or worktree", handler: open });
}
