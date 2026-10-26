import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Client, connectMain } from "./lib/client.ts";
import { ensureSupervisor } from "./lib/ensure.ts";
import type { Timers } from "./lib/lifecycle.ts";
import { createTmux, sessionName } from "./lib/tmux.ts";

const timers: Timers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) };
const SUPERVISOR_PATH = fileURLToPath(new URL("./supervisor.ts", import.meta.url));

export default function (pi: ExtensionAPI): void {
  const tmux = createTmux((command, args, options) => pi.exec(command, args, options));
  let client: Promise<Client> | undefined;

  async function connection(sessionId: string): Promise<Client> {
    const current = client === undefined ? undefined : await client.catch(() => undefined);
    if (current?.isOpen()) return current;
    const next = ensureSupervisor({
      tmux,
      timers,
      sessionId,
      supervisorPath: SUPERVISOR_PATH,
      execPath: process.execPath,
      runtimeRoot: "/tmp",
    }).then(({ socket }) => connectMain(socket, timers));
    client = next;
    try {
      return await next;
    } catch (error) {
      client = undefined;
      throw error;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const name = sessionName(ctx.sessionManager.getSessionId());
    if (await tmux.hasSession(name)) ctx.ui.notify(`subagents: tmux session "${name}" runs. Watch it with "tmux attach -t ${name}".`, "info");
  });

  pi.on("session_shutdown", async () => {
    const current = client;
    client = undefined;
    if (current !== undefined) (await current.catch(() => undefined))?.close();
  });

  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "Delegate tasks to pi agents in a tmux session. status: show the supervisor and its agents.",
    promptSnippet: "Delegate tasks to pi agents in tmux",
    parameters: Type.Object({ action: Type.Literal("status") }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const connected = await connection(ctx.sessionManager.getSessionId());
      const status = await connected.status();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
    },
  });
}
