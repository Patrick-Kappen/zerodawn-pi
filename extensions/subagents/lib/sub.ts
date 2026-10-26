import { forceAnyTool, forceTool } from "./force.ts";
import type { Blocker, GateInfo, Handoff } from "./format.ts";
import type { GateResult } from "./gate.ts";
import type { CommitSpec } from "./git.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

export const MAX_FIELD = 200;
export const MAX_GATE_TRIES = 3;
export const MAX_INVALID_CALLS = 2;

export interface SubEnv {
  socket: string;
  id: string;
  checks: string[];
}

export function readSubEnv(env: Record<string, string | undefined>): SubEnv | undefined {
  const socket = env.PI_SUBAGENT_SOCKET;
  const id = env.PI_SUBAGENT_ID;
  if (socket === undefined && id === undefined) return undefined;
  if (socket === undefined || socket === "" || id === undefined || id === "") {
    throw new Error("subagents: set both PI_SUBAGENT_SOCKET and PI_SUBAGENT_ID, or neither. The supervisor sets both for a subagent.");
  }
  return { socket, id, checks: parseChecks(env.PI_SUBAGENT_CHECKS) };
}

function parseChecks(raw: string | undefined): string[] {
  const next = "The supervisor sets it to a JSON list of strings.";
  if (raw === undefined) throw new Error(`subagents: PI_SUBAGENT_CHECKS is not set. ${next}`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`subagents: PI_SUBAGENT_CHECKS is not valid JSON. ${next}`, { cause });
  }
  if (!Array.isArray(value) || value.some((check) => typeof check !== "string"))
    throw new Error(`subagents: PI_SUBAGENT_CHECKS is not a list of strings. ${next}`);
  return value as string[];
}

export function shorten(text: string, max = MAX_FIELD): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface MessageLike {
  role: string;
  content?: unknown;
  usage?: { totalTokens: number; cost: { total: number } };
}

function textOf(message: MessageLike): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export const HANDOFF_PROMPT = "You reached the token limit. Call the tool handoff now.";
export const GREEN_HANDOFF_PROMPT = "The checks are green. Call the tool handoff now.";
export const GATE_HANDOFF_PROMPT = `The done gate was red ${MAX_GATE_TRIES} times. Call the tool handoff now.`;
export const CHOICE_PROMPT =
  "You stopped. Call continue to keep working, done when the task is finished, ask for a question, or blocker when you cannot go on.";
export const CHOICE_TOOLS = ["continue", "done", "ask", "blocker"];

export interface SubHandlerOptions {
  send: (message: ClientMessage) => void;
  sendUserMessage: (text: string) => void;
  abort: () => void;
  isIdle: () => boolean;
  getActiveTools: () => string[];
  setActiveTools: (names: string[]) => void;
  changed: () => string[];
  commit: (spec: CommitSpec) => Promise<string>;
  gate: (sendUserMessage: (text: string) => void) => Promise<GateResult>;
}

// off: no forced tool. choice: only the CHOICE_TOOLS, one is forced. waiting: aborted, the handoff run starts at the next settle. forced: the handoff is forced. done: handoff sent or agent failed.
type State = "off" | "choice" | "waiting" | "forced" | "done";

export function createSubHandlers(options: SubHandlerOptions) {
  let pending = false;
  let doneCalled = false;
  let redGates = 0;
  let state: State = "off";
  let invalidCalls = 0;
  let gateReason: string | undefined;
  let gateInfo: GateInfo | undefined;
  let savedTools: string[] | undefined;

  const fail = (text: string) => {
    state = "done";
    options.send({ type: "event", event: { kind: "error", text } });
  };
  const saveTools = () => {
    savedTools ??= options.getActiveTools();
  };
  const restoreTools = () => {
    if (savedTools === undefined) return;
    options.setActiveTools(savedTools);
    savedTools = undefined;
  };
  const startHandoff = (prompt: string) => {
    saveTools();
    options.setActiveTools(["handoff"]);
    state = "forced";
    options.sendUserMessage(prompt);
  };
  const leaveChoice = () => {
    if (state !== "choice") return;
    restoreTools();
    state = "off";
  };

  return {
    onServerMessage(message: ServerMessage): void {
      if (message.type === "task") {
        redGates = 0;
        pending = false;
        doneCalled = false;
        gateInfo = undefined;
        gateReason = undefined;
        invalidCalls = 0;
        restoreTools();
        state = "off";
        options.sendUserMessage(message.task);
      } else if (message.type === "handoff") {
        // A gate handoff may already run when the token limit arrives.
        if (state !== "off" && state !== "choice") return;
        saveTools();
        state = "waiting";
        options.abort();
        options.setActiveTools(["handoff"]);
        // abort() ends the run later; a prompt during the run throws. Without a run, no settle comes.
        if (options.isIdle()) {
          state = "forced";
          options.sendUserMessage(HANDOFF_PROMPT);
        }
      } else if (message.type === "error") throw new Error(`subagents: the supervisor refused the request: ${message.message}`);
      else throw new Error(`subagents: the supervisor sent "${message.type}" to a subagent. Stop the supervisor and start it again.`);
    },
    toolStart(event: { toolName: string; args: unknown }): void {
      options.send({ type: "event", event: { kind: "tool_start", name: event.toolName, args: shorten(JSON.stringify(event.args) ?? "") } });
    },
    toolEnd(event: { toolName: string; isError: boolean }): void {
      options.send({ type: "event", event: { kind: "tool_end", name: event.toolName, isError: event.isError } });
      if (state === "forced" && event.toolName === "handoff" && event.isError && ++invalidCalls >= MAX_INVALID_CALLS) {
        fail(`handoff: the model sent ${MAX_INVALID_CALLS} invalid calls of the tool handoff. Read the validation errors in the subagent window.`);
      }
    },
    messageEnd(message: MessageLike): void {
      if (message.role !== "assistant") return;
      if (message.usage === undefined) throw new Error("subagents: an assistant message has no usage. Check the pi version.");
      options.send({
        type: "event",
        event: { kind: "message", text: shorten(textOf(message)), usage: { tokens: message.usage.totalTokens, cost: message.usage.cost.total } },
      });
    },
    ask(question: string): string {
      leaveChoice();
      pending = true;
      options.send({ type: "ask", text: question });
      return "Your question went to the main agent. Stop now and wait for a new message with the answer.";
    },
    blocker(data: Blocker): string {
      leaveChoice();
      pending = true;
      options.send({ type: "blocker", data });
      return "Your blocker went to the main agent. Stop now and wait for a new message.";
    },
    continue(): string {
      if (state !== "choice") throw new Error("continue: the tool is not active. Do not call it until the supervisor asks you to choose.");
      leaveChoice();
      return "Continue with the task.";
    },
    done(): string {
      if (state !== "off" && state !== "choice") throw new Error("done: the tool is not active. Wait for a new message.");
      leaveChoice();
      doneCalled = true;
      return "The checks run now. Stop and wait for the result.";
    },
    async handoff(data: Handoff): Promise<string> {
      if (state !== "forced") throw new Error("handoff: the tool is not active. Do not call it until the supervisor asks for a handoff.");
      const listed = new Set(data.changes.map((change) => change.file));
      const changed = new Set(options.changed());
      const extra = [...listed].filter((file) => !changed.has(file));
      const missing = [...changed].filter((file) => !listed.has(file));
      if (extra.length > 0 || missing.length > 0) {
        throw new Error(
          `handoff: "changes" must list exactly the files that git shows as changed. Changed: ${[...changed].join(", ") || "none"}. Listed: ${[...listed].join(", ") || "none"}. Not changed: ${extra.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}. Call handoff again with the right list.`,
        );
      }
      if (changed.size === 0 && data.findings.length === 0) {
        throw new Error('handoff: no file changed, so "findings" needs at least one entry with path:line. Call handoff again with the findings.');
      }
      const unfinished = gateInfo === undefined ? [`Unfinished: ${gateReason ?? "token limit"}`] : [];
      const commit =
        changed.size === 0
          ? undefined
          : await options.commit({
              subject: data.subject,
              body: [...unfinished, ...data.changes.map((change) => `${change.file}: ${change.what}`)],
              change: data.change,
            });
      options.send({
        type: "handoff",
        data,
        ...(gateReason === undefined ? {} : { reason: gateReason }),
        ...(gateInfo === undefined ? {} : { gate: gateInfo }),
        ...(commit === undefined ? {} : { commit }),
      });
      state = "done";
      return "Handoff sent. Stop.";
    },
    // Returns a changed copy of the payload, or undefined when pi must send it as it is.
    beforeRequest(payload: unknown): unknown {
      if (state !== "waiting" && state !== "forced" && state !== "choice") return undefined;
      try {
        return state === "choice" ? forceAnyTool(payload, CHOICE_TOOLS) : forceTool(payload, "handoff");
      } catch (error) {
        fail((error as Error).message);
        return undefined;
      }
    },
    async settled(): Promise<void> {
      // The gate does not run on unfinished work; the handoff data is the result.
      if (state === "waiting") {
        state = "forced";
        options.sendUserMessage(HANDOFF_PROMPT);
        return;
      }
      if (state === "forced") {
        fail("handoff: the agent stopped without a call of the tool handoff. Read the subagent window.");
        return;
      }
      if (state === "choice") {
        fail("the agent stopped without a call of continue, done, ask or blocker. Read the subagent window.");
        return;
      }
      if (state === "done") return;
      if (pending) {
        pending = false;
        options.send({ type: "event", event: { kind: "settled", text: "" } });
        return;
      }
      if (!doneCalled) {
        saveTools();
        options.setActiveTools(CHOICE_TOOLS);
        state = "choice";
        options.sendUserMessage(CHOICE_PROMPT);
        return;
      }
      doneCalled = false;
      let failures = "";
      let result: GateResult;
      try {
        result = await options.gate((text) => (failures = text));
      } catch (error) {
        // Without this the subagent never settles and the main tool waits forever.
        options.send({ type: "event", event: { kind: "error", text: `done gate failed in the subagent: ${(error as Error).message}` } });
        return;
      }
      options.send({ type: "event", event: { kind: "gate", ok: result.ok, text: shorten(result.reason) } });
      if (result.ok) {
        redGates = 0;
        gateInfo = { ok: true, files: result.files, tests: result.tests };
        startHandoff(GREEN_HANDOFF_PROMPT);
      } else if (++redGates >= MAX_GATE_TRIES) {
        gateReason = shorten(result.reason);
        startHandoff(GATE_HANDOFF_PROMPT);
      } else {
        options.sendUserMessage(failures);
      }
    },
  };
}
