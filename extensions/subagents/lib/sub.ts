import type { GateResult } from "./gate.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

export const MAX_FIELD = 200;
export const MAX_GATE_TRIES = 3;

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

export const HANDOFF_PROMPT =
  "Stop the task now: you reached the token limit. Do not call more tools. Write a handoff for the agent that continues: what is done, what is open, the next step, and the files you changed. Max 15 lines.";

export interface SubHandlerOptions {
  send: (message: ClientMessage) => void;
  sendUserMessage: (text: string) => void;
  steer: (text: string) => void;
  gate: (sendUserMessage: (text: string) => void) => Promise<GateResult>;
}

export function createSubHandlers(options: SubHandlerOptions) {
  let lastText = "";
  let pending = false;
  let redGates = 0;
  let handingOff = false;
  return {
    onServerMessage(message: ServerMessage): void {
      if (message.type === "task") {
        redGates = 0;
        options.sendUserMessage(message.task);
      } else if (message.type === "handoff") {
        handingOff = true;
        options.steer(HANDOFF_PROMPT);
      } else if (message.type === "error") throw new Error(`subagents: the supervisor refused the request: ${message.message}`);
      else throw new Error(`subagents: the supervisor sent "${message.type}" to a subagent. Stop the supervisor and start it again.`);
    },
    toolStart(event: { toolName: string; args: unknown }): void {
      options.send({ type: "event", event: { kind: "tool_start", name: event.toolName, args: shorten(JSON.stringify(event.args) ?? "") } });
    },
    toolEnd(event: { toolName: string; isError: boolean }): void {
      options.send({ type: "event", event: { kind: "tool_end", name: event.toolName, isError: event.isError } });
    },
    messageEnd(message: MessageLike): void {
      if (message.role !== "assistant") return;
      if (message.usage === undefined) throw new Error("subagents: an assistant message has no usage. Check the pi version.");
      lastText = textOf(message);
      options.send({
        type: "event",
        event: { kind: "message", text: shorten(lastText), usage: { tokens: message.usage.totalTokens, cost: message.usage.cost.total } },
      });
    },
    ask(question: string): string {
      pending = true;
      options.send({ type: "ask", text: question });
      return "Your question went to the main agent. Stop now and wait for a new message with the answer.";
    },
    blocker(reason: string): string {
      pending = true;
      options.send({ type: "blocker", text: reason });
      return "Your blocker went to the main agent. Stop now and wait for a new message.";
    },
    async settled(): Promise<void> {
      // The handoff text is the result; the gate does not run on unfinished work.
      if (handingOff) {
        handingOff = false;
        pending = false;
        options.send({ type: "event", event: { kind: "settled", text: lastText } });
        lastText = "";
        return;
      }
      if (!pending) {
        let result: { ok: boolean; reason: string };
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
            options.send({ type: "event", event: { kind: "error", text: shorten(`done gate red ${MAX_GATE_TRIES} times: ${result.reason}`) } });
          } else {
            options.sendUserMessage(failures);
          }
          return;
        }
      }
      redGates = 0;
      pending = false;
      options.send({ type: "event", event: { kind: "settled", text: lastText } });
      lastText = "";
    },
  };
}
