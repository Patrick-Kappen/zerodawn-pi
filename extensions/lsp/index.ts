import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { config } from "../../shared/config.ts";
import { type Deps, defaultRead, LspChecks } from "./lib/lsp.ts";

const EDIT_TOOLS = new Set(["edit", "write"]);

export type RegisterDeps = Omit<Deps, "server" | "nvim"> & { server?: string; nvim?: string };

/** Registers the handlers; without a socket nothing is registered. */
export function registerLsp(pi: ExtensionAPI, deps: RegisterDeps) {
  if (!deps.server) return;
  const checks = new LspChecks({ ...deps, server: deps.server, nvim: deps.nvim ?? "nvim" }, (text) =>
    pi.sendMessage({ customType: "lsp", content: text, display: true }, { triggerTurn: true, deliverAs: "steer" }),
  );

  pi.on("session_start", () => checks.reset());
  pi.on("session_shutdown", () => checks.reset());

  // Print and json mode end when the agent settles, so a background result has nobody to read it: keep the run open for it.
  pi.on("agent_before_settle", async (_event, ctx) => {
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    const edits = checks.editsDone();
    if (edits && (await edits)) return { continue: true };
  });

  pi.on("tool_result", (event, ctx) => {
    if (!EDIT_TOOLS.has(event.toolName)) return;
    const path = (event.input as { path?: unknown }).path;
    // Not awaited: the check goes on in the background, and a message comes only for a problem.
    if (!event.isError && typeof path === "string") void checks.afterEdit(event.toolCallId, path, ctx.cwd);
  });
}

export default function (pi: ExtensionAPI) {
  const server = process.env.PI_LSP_SERVER;
  if (!server) return;
  registerLsp(pi, {
    server,
    nvim: config().nvim ?? "nvim",
    exec: async (command, args) => {
      const result = await pi.exec(command, args, { cwd: process.cwd() });
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    read: defaultRead,
    now: () => performance.now(),
  });
}
