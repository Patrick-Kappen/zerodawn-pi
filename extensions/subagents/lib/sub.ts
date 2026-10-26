import { forceTool } from "./force.ts";
import type { Blocker, Done, Findings, GateInfo, Handoff } from "./format.ts";
import type { GateResult } from "./gate.ts";
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
export const DONE_PROMPT = "The checks are green. Call the tool done now.";
export const GATE_HANDOFF_PROMPT = `The done gate was red ${MAX_GATE_TRIES} times. Call the tool handoff now.`;

export interface SubHandlerOptions {
  send: (message: ClientMessage) => void;
  sendUserMessage: (text: string) => void;
  abort: () => void;
  isIdle: () => boolean;
  getActiveTools: () => string[];
  setActiveTools: (names: string[]) => void;
  changed: () => string[];
  gate: (sendUserMessage: (text: string) => void) => Promise<GateResult>;
}

// off: no forced tool. waiting: aborted, the new run starts at the next settle. forced: the tool choice names the tool in forcedTool. done: sent or failed.
type HandoffState = "off" | "waiting" | "forced" | "done";

export function createSubHandlers(options: SubHandlerOptions) {
  let pending = false;
  let redGates = 0;
  let state: HandoffState = "off";
  let invalidCalls = 0;
  let gateReason: string | undefined;
  let forcedTool = "handoff";
  let gateInfo: GateInfo | undefined;
  let savedTools: string[] | undefined;

  const fail = (text: string) => {
    state = "done";
    options.send({ type: "event", event: { kind: "error", text } });
  };
  const startForced = (tool: string, prompt: string) => {
    forcedTool = tool;
    state = "forced";
    options.sendUserMessage(prompt);
  };

  return {
    onServerMessage(message: ServerMessage): void {
      if (message.type === "task") {
        redGates = 0;
        if (state === "done" && savedTools !== undefined) {
          options.setActiveTools(savedTools);
          savedTools = undefined;
          state = "off";
          invalidCalls = 0;
        }
        options.sendUserMessage(message.task);
      } else if (message.type === "handoff") {
        // A gate handoff may already run when the token limit arrives.
        if (state !== "off") return;
        state = "waiting";
        options.abort();
        options.setActiveTools(["handoff"]);
        // abort() ends the run later; a prompt during the run throws. Without a run, no settle comes.
        if (options.isIdle()) startForced("handoff", HANDOFF_PROMPT);
      } else if (message.type === "error") throw new Error(`subagents: the supervisor refused the request: ${message.message}`);
      else throw new Error(`subagents: the supervisor sent "${message.type}" to a subagent. Stop the supervisor and start it again.`);
    },
    toolStart(event: { toolName: string; args: unknown }): void {
      options.send({ type: "event", event: { kind: "tool_start", name: event.toolName, args: shorten(JSON.stringify(event.args) ?? "") } });
    },
    toolEnd(event: { toolName: string; isError: boolean }): void {
      options.send({ type: "event", event: { kind: "tool_end", name: event.toolName, isError: event.isError } });
      if (state === "forced" && event.toolName === forcedTool && event.isError && ++invalidCalls >= MAX_INVALID_CALLS) {
        fail(`${forcedTool}: the model sent ${MAX_INVALID_CALLS} invalid calls of the tool ${forcedTool}. Read the validation errors in the subagent window.`);
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
      pending = true;
      options.send({ type: "ask", text: question });
      return "Your question went to the main agent. Stop now and wait for a new message with the answer.";
    },
    blocker(data: Blocker): string {
      pending = true;
      options.send({ type: "blocker", data });
      return "Your blocker went to the main agent. Stop now and wait for a new message.";
    },
    handoff(data: Handoff): string {
      if (state !== "forced") throw new Error("handoff: the tool is not active. Do not call it until the supervisor asks for a handoff.");
      options.send(gateReason === undefined ? { type: "handoff", data } : { type: "handoff", data, reason: gateReason });
      state = "done";
      return "Handoff sent. Stop.";
    },
    done(data: Done): string {
      if (state !== "forced" || forcedTool !== "done" || gateInfo === undefined) {
        throw new Error("done: the tool is not active. Do not call it until the checks are green.");
      }
      const listed = new Set(data.changes.map((change) => change.file));
      const changed = new Set(options.changed());
      const extra = [...listed].filter((file) => !changed.has(file));
      const missing = [...changed].filter((file) => !listed.has(file));
      if (extra.length > 0 || missing.length > 0) {
        throw new Error(
          `done: "changes" must list exactly the files that git shows as changed. Changed: ${[...changed].join(", ") || "none"}. Listed: ${[...listed].join(", ")}. Not changed: ${extra.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}. Call done again with the right list.`,
        );
      }
      options.send({ type: "done", data, gate: gateInfo });
      state = "done";
      return "Done sent. Stop.";
    },
    doneFindings(data: Findings): string {
      if (state !== "forced" || forcedTool !== "done_findings" || gateInfo === undefined) {
        throw new Error("done_findings: the tool is not active. Do not call it until the checks are green.");
      }
      options.send({ type: "done", data, gate: gateInfo });
      state = "done";
      return "Done sent. Stop.";
    },
    // Returns a changed copy of the payload, or undefined when pi must send it as it is.
    beforeRequest(payload: unknown): unknown {
      if (state !== "waiting" && state !== "forced") return undefined;
      try {
        return forceTool(payload, forcedTool);
      } catch (error) {
        fail((error as Error).message);
        return undefined;
      }
    },
    async settled(): Promise<void> {
      // The gate does not run on unfinished work; the handoff data is the result.
      if (state === "waiting") {
        startForced("handoff", HANDOFF_PROMPT);
        return;
      }
      if (state === "forced") {
        fail(`${forcedTool}: the agent stopped without a call of the tool ${forcedTool}. Read the subagent window.`);
        return;
      }
      if (state === "done") return;
      let result: GateResult | undefined;
      if (!pending) {
        let failures = "";
        try {
          result = await options.gate((text) => (failures = text));
        } catch (error) {
          // Without this the subagent never settles and the main tool waits forever.
          options.send({ type: "event", event: { kind: "error", text: `done gate failed in the subagent: ${(error as Error).message}` } });
          return;
        }
        options.send({ type: "event", event: { kind: "gate", ok: result.ok, text: shorten(result.reason) } });
        if (!result.ok) {
          redGates++;
          if (redGates >= MAX_GATE_TRIES) {
            gateReason = shorten(result.reason);
            options.setActiveTools(["handoff"]);
            startForced("handoff", GATE_HANDOFF_PROMPT);
          } else {
            options.sendUserMessage(failures);
          }
          return;
        }
      }
      redGates = 0;
      if (result?.ok) {
        gateInfo = { ok: true, files: result.files, tests: result.tests };
        savedTools = options.getActiveTools();
        forcedTool = result.files.length > 0 ? "done" : "done_findings";
        options.setActiveTools([forcedTool]);
        startForced(forcedTool, DONE_PROMPT);
        return;
      }
      pending = false;
      options.send({ type: "event", event: { kind: "settled", text: "" } });
    },
  };
}
