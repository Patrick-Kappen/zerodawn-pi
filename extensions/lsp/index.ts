import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { config } from "../../shared/config.ts";
import { noEnv } from "./lib/format.ts";
import { Lsp } from "./lib/run.ts";

const EDIT_TOOLS = new Set(["edit", "write"]);

export default function (pi: ExtensionAPI) {
  const nvim = config().nvim ?? "nvim";
  let lsp: Lsp | undefined;

  const runner = (ctx: ExtensionContext) => async (command: string, args: string[]) => {
    const r = await pi.exec(command, args, { cwd: ctx.cwd });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  };

  pi.on("session_start", async (_event, ctx) => {
    lsp?.reset();
    lsp = undefined;
    if (!process.env.PI_NVIM_SERVER) {
      ctx.ui.notify(`lsp: ${noEnv}`, "warning");
      return;
    }
    lsp = new Lsp(
      {
        nvim,
        env: process.env,
        run: runner(ctx),
        exists: existsSync,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        read: (path) => readFileSync(path, "utf8"),
      },
      (text) => pi.sendMessage({ customType: "lsp", content: text, display: true }, { triggerTurn: true, deliverAs: "steer" }),
    );
    try {
      await lsp.ensure();
    } catch (err) {
      ctx.ui.notify(err instanceof Error ? err.message : String(err), "warning");
    }
  });

  pi.on("session_shutdown", () => {
    lsp?.reset();
    lsp = undefined;
  });

  pi.on("tool_result", (event, ctx) => {
    if (!EDIT_TOOLS.has(event.toolName) || event.isError) return;
    const path = (event.input as { path?: unknown }).path;
    if (typeof path !== "string" || !lsp) return;
    // Not awaited: the check runs in the background, and a message comes only for an error.
    void lsp.afterEdit(path, ctx.cwd);
  });

  // Print and json mode end when the agent settles, so a background result has nobody to read it: keep the run open for it.
  pi.on("agent_before_settle", async (_event, ctx) => {
    if (!lsp || (ctx.mode !== "print" && ctx.mode !== "json")) return;
    const edits = lsp.editsDone();
    if (edits && (await edits)) return { continue: true };
  });
}
