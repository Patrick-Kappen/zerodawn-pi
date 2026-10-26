import type { Blocker, GateInfo, Handoff } from "./format.ts";
import type { AgentEntry } from "./register.ts";

export interface Usage {
  tokens: number;
  cost: number;
}

export type SubEvent =
  | { kind: "tool_start"; name: string; args: string }
  | { kind: "tool_end"; name: string; isError: boolean }
  | { kind: "message"; text: string; usage: Usage }
  | { kind: "settled"; text: string }
  | { kind: "gate"; ok: boolean; text: string }
  | { kind: "error"; text: string };

export type AgentStatus = "idle" | "failed" | "question" | "blocked" | "handoff";

export interface AgentResult {
  id: string;
  status: AgentStatus;
  text: string;
  usage: Usage;
  events: string[];
  blocker?: Blocker;
  handoff?: Handoff;
  reason?: string;
  gate?: GateInfo;
}

export type ClientMessage =
  | { type: "hello"; role: "main" }
  | { type: "hello"; role: "sub"; id: string }
  | { type: "status" }
  | { type: "start"; task: string; args: string[]; checks: string[] }
  | { type: "answer"; id: string; text: string }
  | { type: "ask"; text: string }
  | { type: "blocker"; data: Blocker }
  | { type: "handoff"; data: Handoff; reason?: string; gate?: GateInfo }
  | { type: "event"; event: SubEvent };

export type ServerMessage =
  | { type: "status"; agents: AgentEntry[]; main: "connected" | "gone" }
  | { type: "error"; message: string }
  | { type: "started"; id: string }
  | { type: "task"; task: string }
  | { type: "handoff" }
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

function strings(fields: Fields, key: string, type: string): string[] {
  const value = fields[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`protocol: field "${key}" of "${type}" must be a list of strings. Fix the sender.`);
  }
  return value as string[];
}

function object(fields: Fields, key: string, type: string): Fields {
  const value = fields[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`protocol: field "${key}" of "${type}" must be an object. Fix the sender.`);
  }
  return value as Fields;
}

function parseBlocker(fields: Fields, type: string): Blocker {
  return { issue: text(fields, "issue", type), files: strings(fields, "files", type), tried: strings(fields, "tried", type) };
}

function parseHandoff(fields: Fields, type: string): Handoff {
  return {
    summary: text(fields, "summary", type),
    changes: objects(fields, "changes", type, ["file", "what"]) as Handoff["changes"],
    tests: objects(fields, "tests", type, ["file", "covers"]) as Handoff["tests"],
    findings: strings(fields, "findings", type),
    decisions: strings(fields, "decisions", type),
    open: strings(fields, "open", type),
    next: text(fields, "next", type),
    risks: strings(fields, "risks", type),
  };
}

function objects(fields: Fields, key: string, type: string, names: [string, string]): Record<string, string>[] {
  const value = fields[key];
  const bad = () =>
    new Error(`protocol: field "${key}" of "${type}" must be a list of objects with the strings "${names[0]}" and "${names[1]}". Fix the sender.`);
  if (!Array.isArray(value)) throw bad();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || names.some((name) => typeof (entry as Fields)[name] !== "string")) throw bad();
    return { [names[0]]: (entry as Fields)[names[0]], [names[1]]: (entry as Fields)[names[1]] } as Record<string, string>;
  });
}

function parseGate(fields: Fields, type: string): GateInfo {
  if (fields.ok !== true) throw new Error(`protocol: field "ok" of "${type}" must be true. Fix the sender.`);
  return { ok: true, files: strings(fields, "files", type), tests: text(fields, "tests", type) };
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
    case "gate": {
      if (typeof event.ok !== "boolean") throw new Error('protocol: field "ok" of "gate" must be a boolean. Fix the sender.');
      return { kind: "gate", ok: event.ok, text: text(event, "text", "gate") };
    }
    case "error":
      return { kind: "error", text: text(event, "text", "error") };
  }
  throw new Error(`protocol: unknown event kind ${JSON.stringify(event.kind)}. Use "tool_start", "tool_end", "message", "settled" or "gate".`);
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
      if (!Array.isArray(message.checks) || message.checks.some((check) => typeof check !== "string")) {
        throw new Error('protocol: field "checks" of "start" must be a list of strings. Fix the sender.');
      }
      return { type: "start", task, args: message.args as string[], checks: message.checks as string[] };
    }
    case "answer":
      return { type: "answer", id: text(message, "id", "answer"), text: text(message, "text", "answer") };
    case "ask":
      return { type: "ask", text: text(message, "text", "ask") };
    case "blocker":
      return { type: "blocker", data: parseBlocker(object(message, "data", "blocker"), "blocker") };
    case "handoff": {
      const data = parseHandoff(object(message, "data", "handoff"), "handoff");
      return {
        type: "handoff",
        data,
        ...(message.reason === undefined ? {} : { reason: text(message, "reason", "handoff") }),
        ...(message.gate === undefined ? {} : { gate: parseGate(object(message, "gate", "handoff"), "handoff.gate") }),
      };
    }
    case "event":
      return { type: "event", event: parseEvent(message.event) };
  }
  throw new Error(
    `protocol: unknown message type ${JSON.stringify(message.type)}. Use "hello", "status", "start", "answer", "ask", "blocker", "handoff" or "event".`,
  );
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
    case "handoff":
      return { type: "handoff" };
    case "status":
      if (Array.isArray(message.agents) && (message.main === "connected" || message.main === "gone")) {
        return { type: "status", agents: message.agents, main: message.main };
      }
      break;
    case "result": {
      if (
        message.status !== "idle" &&
        message.status !== "failed" &&
        message.status !== "question" &&
        message.status !== "blocked" &&
        message.status !== "handoff"
      )
        break;
      if (!Array.isArray(message.events) || message.events.some((event) => typeof event !== "string")) break;
      return {
        type: "result",
        id: text(message, "id", "result"),
        status: message.status,
        text: text(message, "text", "result"),
        usage: usage(message, "result"),
        events: message.events as string[],
        ...(message.blocker === undefined ? {} : { blocker: parseBlocker(object(message, "blocker", "result"), "result.blocker") }),
        ...(message.handoff === undefined ? {} : { handoff: parseHandoff(object(message, "handoff", "result"), "result.handoff") }),
        ...(message.reason === undefined ? {} : { reason: text(message, "reason", "result") }),
        ...(message.gate === undefined ? {} : { gate: parseGate(object(message, "gate", "result"), "result.gate") }),
      };
    }
  }
  throw new Error(`protocol: the supervisor sent an unknown message: ${line}. Stop the supervisor and start it again.`);
}
