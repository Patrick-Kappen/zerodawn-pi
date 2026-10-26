import type { AgentEntry } from "./register.ts";

export interface Usage {
  tokens: number;
  cost: number;
}

export type SubEvent =
  | { kind: "tool_start"; name: string; args: string }
  | { kind: "tool_end"; name: string; isError: boolean }
  | { kind: "message"; text: string; usage: Usage }
  | { kind: "settled"; text: string };

export interface AgentResult {
  id: string;
  status: "idle" | "failed";
  text: string;
  usage: Usage;
  events: string[];
}

export type ClientMessage =
  | { type: "hello"; role: "main" }
  | { type: "hello"; role: "sub"; id: string }
  | { type: "status" }
  | { type: "start"; task: string; args: string[] }
  | { type: "event"; event: SubEvent };

export type ServerMessage =
  | { type: "status"; agents: AgentEntry[]; main: "connected" | "gone" }
  | { type: "error"; message: string }
  | { type: "started"; id: string }
  | { type: "task"; task: string }
  | ({ type: "result" } & AgentResult);

type Fields = Record<string, unknown>;

function parseObject(line: string, who: string, next: string): Fields {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new Error(`protocol: ${who} line is not valid JSON. ${next}`, { cause });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`protocol: ${who} line is not a JSON object. ${next}`);
  }
  return value as Fields;
}

function text(fields: Fields, key: string, type: string): string {
  const value = fields[key];
  if (typeof value !== "string") throw new Error(`protocol: field "${key}" of "${type}" must be a string. Fix the sender.`);
  return value;
}

function number(fields: Fields, key: string, type: string): number {
  const value = fields[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`protocol: field "${key}" of "${type}" must be a number. Fix the sender.`);
  return value;
}

function usage(fields: Fields, type: string): Usage {
  const value = fields.usage;
  if (typeof value !== "object" || value === null) throw new Error(`protocol: field "usage" of "${type}" must be an object. Fix the sender.`);
  return { tokens: number(value as Fields, "tokens", type), cost: number(value as Fields, "cost", type) };
}

function parseEvent(value: unknown): SubEvent {
  if (typeof value !== "object" || value === null) throw new Error('protocol: field "event" of "event" must be an object. Fix the sender.');
  const event = value as Fields;
  switch (event.kind) {
    case "tool_start":
      return { kind: "tool_start", name: text(event, "name", "tool_start"), args: text(event, "args", "tool_start") };
    case "tool_end": {
      if (typeof event.isError !== "boolean") throw new Error('protocol: field "isError" of "tool_end" must be a boolean. Fix the sender.');
      return { kind: "tool_end", name: text(event, "name", "tool_end"), isError: event.isError };
    }
    case "message":
      return { kind: "message", text: text(event, "text", "message"), usage: usage(event, "message") };
    case "settled":
      return { kind: "settled", text: text(event, "text", "settled") };
  }
  throw new Error(`protocol: unknown event kind ${JSON.stringify(event.kind)}. Use "tool_start", "tool_end", "message" or "settled".`);
}

export function parseClientLine(line: string): ClientMessage {
  const message = parseObject(line, "client", "Send one JSON object per line.");
  switch (message.type) {
    case "status":
      return { type: "status" };
    case "hello":
      if (message.role === "main") return { type: "hello", role: "main" };
      if (message.role === "sub") return { type: "hello", role: "sub", id: text(message, "id", "hello") };
      throw new Error(`protocol: hello has role ${JSON.stringify(message.role)}. Use "main" or "sub".`);
    case "start": {
      const task = text(message, "task", "start");
      if (!Array.isArray(message.args) || message.args.some((arg) => typeof arg !== "string")) {
        throw new Error('protocol: field "args" of "start" must be a list of strings. Fix the sender.');
      }
      return { type: "start", task, args: message.args as string[] };
    }
    case "event":
      return { type: "event", event: parseEvent(message.event) };
  }
  throw new Error(`protocol: unknown message type ${JSON.stringify(message.type)}. Use "hello", "status", "start" or "event".`);
}

export function formatServerMessage(message: ServerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function formatClientMessage(message: ClientMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseServerLine(line: string): ServerMessage {
  const message = parseObject(line, "supervisor", "Stop the supervisor and start it again.");
  switch (message.type) {
    case "error":
      return { type: "error", message: text(message, "message", "error") };
    case "started":
      return { type: "started", id: text(message, "id", "started") };
    case "task":
      return { type: "task", task: text(message, "task", "task") };
    case "status":
      if (Array.isArray(message.agents) && (message.main === "connected" || message.main === "gone")) {
        return { type: "status", agents: message.agents, main: message.main };
      }
      break;
    case "result": {
      if (message.status !== "idle" && message.status !== "failed") break;
      if (!Array.isArray(message.events) || message.events.some((event) => typeof event !== "string")) break;
      return {
        type: "result",
        id: text(message, "id", "result"),
        status: message.status,
        text: text(message, "text", "result"),
        usage: usage(message, "result"),
        events: message.events as string[],
      };
    }
  }
  throw new Error(`protocol: the supervisor sent an unknown message: ${line}. Stop the supervisor and start it again.`);
}
