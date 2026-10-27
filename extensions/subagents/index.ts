import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExecOptions, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { config, subagentModels } from "../../shared/config.ts";
import { loadRecipes } from "../../shared/recipes.ts";
import { changedFiles, execute, inProjectEnv, plan, uncoveredOf } from "../../shared/testrun.ts";
import { type Client, connectMain } from "./lib/client.ts";
import { ensureSupervisor } from "./lib/ensure.ts";
import { runGate } from "./lib/gate.ts";
import { commitAll, git, resolveBase } from "./lib/git.ts";
import type { Timers } from "./lib/lifecycle.ts";
import { cleanupAt, cleanupMerged, mergeBranches } from "./lib/merge.ts";
import { checkLadder, createAvailability, probeModel } from "./lib/models.ts";
import { answers } from "./lib/probe.ts";
import type { FailedModel } from "./lib/protocol.ts";
import { nodeFiles, resolveProfile } from "./lib/resolve.ts";
import { shapeResult } from "./lib/result.ts";
import { askSchema, blockerSchema, continueSchema, doneSchema, handoffSchema } from "./lib/schemas.ts";
import { createSubHandlers, readSubEnv, type SubEnv } from "./lib/sub.ts";
import { connectSub, type SubConnection } from "./lib/subclient.ts";
import { createTmux, sessionName } from "./lib/tmux.ts";

const timers: Timers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) };
const SUPERVISOR_PATH = fileURLToPath(new URL("./supervisor.ts", import.meta.url));
const FORCED_TOOLS = ["handoff", "continue"];
const EXTENSION_PATH = fileURLToPath(import.meta.url);

function registerSub(pi: ExtensionAPI, env: SubEnv): void {
  let connection: SubConnection | undefined;
  let cwd = process.cwd();
  let context: ExtensionContext | undefined;
  const running = (): ExtensionContext => {
    if (context === undefined) throw new Error("subagents: no context yet. The session_start handler did not run.");
    return context;
  };
  const connected = (): SubConnection => {
    if (connection === undefined) throw new Error(`subagents: no connection to "${env.socket}". The session_start handler failed; read the error above.`);
    return connection;
  };
  const handlers = createSubHandlers({
    send: (message) => connected().send(message),
    sendUserMessage: (text) => void pi.sendUserMessage(text),
    abort: () => running().abort(),
    isIdle: () => running().isIdle(),
    getActiveTools: () => pi.getActiveTools(),
    setActiveTools: (names) => pi.setActiveTools(names),
    changed: () => changedFiles(cwd),
    commit: (spec) => commitAll((command, args, options) => pi.exec(command, args, options), cwd, spec),
    gate: (sendUserMessage) =>
      runGate({
        checks: env.checks,
        changed: () => changedFiles(cwd),
        uncovered: (changed) => uncoveredOf(cwd, changed).uncovered,
        testCommand: () => {
          const all = plan(cwd, loadRecipes(cwd), "all", []);
          if (!("run" in all)) throw new Error(`subagents: plan for every test gave no command in ${cwd}.`);
          return all.run;
        },
        run: (argv) => execute(inProjectEnv(argv, cwd), cwd, undefined),
        sendUserMessage,
      }),
  });

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    context = ctx;
    pi.setActiveTools(pi.getActiveTools().filter((name) => !FORCED_TOOLS.includes(name)));
    connection = await connectSub(env, handlers.onServerMessage, (error) => ctx.ui.notify(error.message, "error"));
  });
  pi.registerTool({
    name: "ask",
    label: "ask",
    description: "Ask the main agent a question. Use it when you need an answer to go on. After the call, stop and wait for a new message.",
    parameters: askSchema,
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: handlers.ask(params.question) }], details: {} };
    },
  });
  pi.registerTool({
    name: "blocker",
    label: "blocker",
    description:
      "Report that you cannot go on within the limits of your task: missing access, information or a decision. Use it only after you tried to solve the problem within the task limits. After the call, stop and wait for a new message.",
    parameters: blockerSchema,
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: handlers.blocker(params) }], details: {} };
    },
  });
  pi.registerTool({
    name: "handoff",
    label: "handoff",
    description:
      "Report the result and hand the task over. The extension asks for it; do not call it before. The extension commits your changes with your subject. After the call, stop.",
    parameters: handoffSchema,
    async execute(_toolCallId, params) {
      return { content: [{ type: "text", text: await handlers.handoff(params) }], details: {} };
    },
  });
  pi.registerTool({
    name: "continue",
    label: "continue",
    description: "Keep working on the task. The extension asks you to choose when you stop; do not call it before.",
    parameters: continueSchema,
    async execute() {
      return { content: [{ type: "text", text: handlers.continue() }], details: {} };
    },
  });
  pi.registerTool({
    name: "done",
    label: "done",
    description: "The task is finished. The checks run next. After the call, stop and wait.",
    parameters: doneSchema,
    async execute() {
      return { content: [{ type: "text", text: handlers.done() }], details: {} };
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
  const execGit = (command: string, args: string[], options?: ExecOptions) => pi.exec(command, args, options);
  let client: Promise<Client> | undefined;
  const availability = createAvailability(() => Date.now());

  // The ladder entries from the first available model on; the supervisor restarts on the next one after a provider error.
  async function ladder(ctx: ExtensionContext): Promise<{ models: string[]; skipped: FailedModel[] }> {
    const entries = subagentModels();
    const models = checkLadder(ctx.modelRegistry, entries);
    const { entry, failed } = await availability.pick(entries, (name) =>
      probeModel(ctx.modelRegistry, models.get(name) as NonNullable<ReturnType<typeof ctx.modelRegistry.find>>),
    );
    return { models: entries.slice(entries.indexOf(entry)), skipped: failed.map((item) => ({ model: item.entry, reason: item.reason })) };
  }

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
    const removed = await cleanupAt({ exec: execGit, cwd: ctx.cwd, home: homedir(), runtimeRoot: "/tmp" });
    if (removed.length > 0) ctx.ui.notify(`subagents: ${removed.join("\n")}`, "info");
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
      "Delegate a task to a pi agent in its own git worktree, in a tmux session. start runs the task and returns the final answer. answer sends text and waits for the next result. merge merges the branches of ids in order with a merge commit and removes their worktrees; on a conflict nothing of that agent is merged and a merge agent resolves it. discard removes the worktree and branch of an agent that does not run. status shows the agents. A result has status idle, failed, question, blocked or handoff: answer a question; for blocked, first try to solve it yourself, then answer with the solution; for handoff (token limit), start a new agent with the handoff text in its task.",
    promptSnippet: "Delegate tasks to pi agents in tmux",
    // One object at the root: a root anyOf made the model send empty arguments.
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("answer"), Type.Literal("discard"), Type.Literal("merge"), Type.Literal("status")]),
      profile: Type.Optional(Type.String({ description: "Required for start. Name of a profile in ~/.pi/agent/agents/<name>.md." })),
      task: Type.Optional(Type.String({ description: "Required for start. The complete task. The agent knows nothing else." })),
      base: Type.Optional(
        Type.String({
          description: "For start. A branch, a commit, or the absolute path of a worktree (then its HEAD). Default: the HEAD of the current directory.",
        }),
      ),
      id: Type.Optional(Type.String({ description: "Required for answer and discard. The id of the agent." })),
      ids: Type.Optional(Type.Array(Type.String(), { description: "Required for merge. The ids of the agents to merge, in order." })),
      into: Type.Optional(Type.String({ description: "For merge. The target branch. Default: the branch checked out in the current directory." })),
      text: Type.Optional(Type.String({ description: "Required for answer. The answer for the agent." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.action === "answer") {
        if (params.id === undefined || params.id.trim() === "") throw new Error('subagent: action "answer" needs an "id".');
        if (params.text === undefined || params.text.trim() === "") throw new Error('subagent: action "answer" needs a non-empty "text".');
        const connected = await connection(ctx.sessionManager.getSessionId());
        return shapeResult(await connected.answer(params.id, params.text, signal));
      }
      if (params.action === "discard") {
        if (params.id === undefined || params.id.trim() === "") throw new Error('subagent: action "discard" needs an "id".');
        const connected = await connection(ctx.sessionManager.getSessionId());
        const text = await connected.discard(params.id);
        return { content: [{ type: "text", text }], details: { id: params.id } };
      }
      if (params.action === "merge") {
        if (params.ids === undefined || params.ids.length === 0) throw new Error('subagent: action "merge" needs "ids", a non-empty list of agent ids.');
        const connected = await connection(ctx.sessionManager.getSessionId());
        const home = homedir();
        const deps = { exec: execGit, cwd: ctx.cwd, home, runtimeRoot: "/tmp" };
        let text = await mergeBranches(
          {
            ...deps,
            agents: async () => (await connected.status()).agents,
            discard: (id) => connected.discard(id),
            startMerge: async (task, source) => {
              const { args, profile } = await resolveProfile(home, "merge", nodeFiles);
              return connected.begin(task, args, profile.checks, (await ladder(ctx)).models, source);
            },
          },
          params.ids,
          params.into,
        );
        try {
          const repo = (await resolveBase(execGit, ctx.cwd)).repo;
          // A branch that a merge agent merged is in the target too; it goes away with the merged ones.
          const into = params.into ?? (await git(execGit, ["-C", ctx.cwd, "symbolic-ref", "--short", "HEAD"], "the branch of the main pi is not known"));
          const removed = [...(await cleanupMerged(deps, repo, into)), ...(await cleanupMerged(deps, repo))];
          if (removed.length > 0) text += `\n${removed.join("\n")}`;
        } catch (error) {
          text += `\ncleanup of merged worktrees failed: ${(error as Error).message}`;
        }
        return { content: [{ type: "text", text }], details: { ids: params.ids } };
      }
      if (params.action === "start" && (params.task === undefined || params.task.trim() === "")) {
        throw new Error('subagent: action "start" needs a non-empty "task".');
      }
      if (params.action === "start" && (params.profile === undefined || params.profile.trim() === "")) {
        throw new Error(`subagent: action "start" needs a "profile". Expected a file ~/.pi/agent/agents/<name>.md.`);
      }
      if (params.action === "start") {
        const { args, profile } = await resolveProfile(homedir(), params.profile as string, nodeFiles);
        const { models, skipped } = await ladder(ctx);
        const source = await resolveBase((command, commandArgs, options) => pi.exec(command, commandArgs, options), ctx.cwd, params.base);
        const connected = await connection(ctx.sessionManager.getSessionId());
        const result = await connected.start(params.task as string, args, profile.checks, models, source, signal);
        const failedModels = [...skipped, ...(result.failedModels ?? [])];
        const shaped = shapeResult(failedModels.length === 0 ? result : { ...result, failedModels });
        if (source.dirty) shaped.content[0].text += `\nuncommitted changes in ${ctx.cwd} are not in the subagent`;
        return shaped;
      }
      const connected = await connection(ctx.sessionManager.getSessionId());
      const status = await connected.status();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }], details: status };
    },
  });
}
