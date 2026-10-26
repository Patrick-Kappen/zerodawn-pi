import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { config } from "../../shared/config.ts";
import { type Client, connectMain } from "./lib/client.ts";
import { ensureSupervisor } from "./lib/ensure.ts";
import type { Timers } from "./lib/lifecycle.ts";
import { answers } from "./lib/probe.ts";
import { nodeFiles, resolveProfile } from "./lib/resolve.ts";
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
  pi.registerTool({
    name: "ask",
    label: "ask",
    description: "Ask the main agent a question. Use it when you need an answer to go on. After the call, stop and wait for a new message.",
    parameters: Type.Object({ question: Type.String({ description: "The question for the main agent." }) }),
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: handlers.ask(params.question) }], details: {} };
    },
  });
  pi.registerTool({
    name: "blocker",
    label: "blocker",
    description:
      "Report that you cannot go on within the limits of your task: missing access, information or a decision. Use it only after you tried to solve the problem within the task limits. After the call, stop and wait for a new message.",
    parameters: Type.Object({ reason: Type.String({ description: "What blocks you and what you tried." }) }),
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: handlers.blocker(params.reason) }], details: {} };
    },
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
      "Delegate tasks to pi agents in a tmux session. start: run the task in a new agent and return its final answer. answer: send text to an agent by id and wait for its next result. status: show the supervisor and its agents. A result has status idle, failed, question or blocked. On question, answer it with answer. On blocked, first try to solve the problem within your own limits, then send the solution with answer.",
    promptSnippet: "Delegate tasks to pi agents in tmux",
    // One object at the root: a root anyOf made the model send empty arguments.
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("answer"), Type.Literal("status")]),
      profile: Type.Optional(Type.String({ description: "Required for start. Name of a profile in ~/.pi/agent/agents/<name>.md." })),
      task: Type.Optional(Type.String({ description: "Required for start. The complete task. The agent knows nothing else." })),
      id: Type.Optional(Type.String({ description: "Required for answer. The id of the agent." })),
      text: Type.Optional(Type.String({ description: "Required for answer. The answer for the agent." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.action === "answer") {
        if (params.id === undefined || params.id.trim() === "") throw new Error('subagent: action "answer" needs an "id".');
        if (params.text === undefined || params.text.trim() === "") throw new Error('subagent: action "answer" needs a non-empty "text".');
        const connected = await connection(ctx.sessionManager.getSessionId());
        return shapeResult(await connected.answer(params.id, params.text, signal));
      }
      if (params.action === "start" && (params.task === undefined || params.task.trim() === "")) {
        throw new Error('subagent: action "start" needs a non-empty "task".');
      }
      if (params.action === "start" && (params.profile === undefined || params.profile.trim() === "")) {
        throw new Error(`subagent: action "start" needs a "profile". Expected a file ~/.pi/agent/agents/<name>.md.`);
      }
      if (params.action === "start") {
        const { args } = await resolveProfile(homedir(), params.profile as string, nodeFiles);
        const connected = await connection(ctx.sessionManager.getSessionId());
        return shapeResult(await connected.start(params.task as string, args, signal));
      }
      const connected = await connection(ctx.sessionManager.getSessionId());
      const status = await connected.status();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
    },
  });
}
