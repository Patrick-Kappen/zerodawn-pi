import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { config } from "../../shared/config.ts";
import { type Client, connectMain } from "./lib/client.ts";
import { ensureSupervisor } from "./lib/ensure.ts";
import type { Timers } from "./lib/lifecycle.ts";
import { answers } from "./lib/probe.ts";
import { shapeResult } from "./lib/result.ts";
import { createSubHandlers, readSubEnv, type SubEnv } from "./lib/sub.ts";
import { connectSub, type SubConnection } from "./lib/subclient.ts";
import { createTmux, sessionName } from "./lib/tmux.ts";

const timers: Timers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) };
const SUPERVISOR_PATH = fileURLToPath(new URL("./supervisor.ts", import.meta.url));
const EXTENSION_PATH = fileURLToPath(import.meta.url);

function registerSub(pi: ExtensionAPI, env: SubEnv): void {
  let connection: SubConnection | undefined;
  const connected = (): SubConnection => {
    if (connection === undefined) throw new Error(`subagents: no connection to "${env.socket}". The session_start handler failed; read the error above.`);
    return connection;
  };
  const handlers = createSubHandlers({
    send: (message) => connected().send(message),
    sendUserMessage: (text) => void pi.sendUserMessage(text),
  });

  pi.on("session_start", async (_event, ctx) => {
    connection = await connectSub(env, handlers.onServerMessage, (error) => ctx.ui.notify(error.message, "error"));
  });
  pi.on("session_shutdown", () => connection?.close());
  pi.on("tool_execution_start", (event) => handlers.toolStart(event));
  pi.on("tool_execution_end", (event) => handlers.toolEnd(event));
  pi.on("message_end", (event) => handlers.messageEnd(event.message));
  pi.on("agent_settled", () => handlers.settled());
}

export default function (pi: ExtensionAPI): void {
  const sub = readSubEnv(process.env);
  if (sub !== undefined) {
    registerSub(pi, sub);
    return;
  }
  const tmux = createTmux((command, args, options) => pi.exec(command, args, options));
  let client: Promise<Client> | undefined;

  async function connection(sessionId: string): Promise<Client> {
    const current = client === undefined ? undefined : await client.catch(() => undefined);
    if (current?.isOpen()) return current;
    const { subagentExtensions } = config();
    if (subagentExtensions === undefined) {
      throw new Error(
        'subagents: config.json has no "subagentExtensions". A subagent starts with no extensions, so it has no provider login. Add the path of your provider extension (see config.example.json), or [] to start without one.',
      );
    }
    const next = ensureSupervisor({
      tmux,
      timers,
      sessionId,
      supervisorPath: SUPERVISOR_PATH,
      execPath: process.execPath,
      piCommand: "pi",
      extensionPaths: [EXTENSION_PATH, ...subagentExtensions],
      probe: answers,
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
    description:
      "Delegate tasks to pi agents in a tmux session. start: run the task in a new agent and return its final answer. status: show the supervisor and its agents.",
    promptSnippet: "Delegate tasks to pi agents in tmux",
    // One object at the root: a root anyOf made the model send empty arguments.
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("status")]),
      task: Type.Optional(Type.String({ description: "Required for start. The complete task. The agent knows nothing else." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.action === "start" && (params.task === undefined || params.task.trim() === "")) {
        throw new Error('subagent: action "start" needs a non-empty "task".');
      }
      const connected = await connection(ctx.sessionManager.getSessionId());
      if (params.action === "start") return shapeResult(await connected.start(params.task as string, signal));
      const status = await connected.status();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
    },
  });
}
