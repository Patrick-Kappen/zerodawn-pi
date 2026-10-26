import type { AgentEntry } from "./register.ts";

export type ClientMessage = { type: "hello"; role: "main" } | { type: "status" };

export type ServerMessage = { type: "status"; agents: AgentEntry[]; main: "connected" | "gone" } | { type: "error"; message: string };

export function parseClientLine(line: string): ClientMessage {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new Error("protocol: line is not valid JSON. Send one JSON object per line.", { cause });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("protocol: line is not a JSON object. Send one JSON object per line.");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "status") return { type: "status" };
  if (message.type === "hello") {
    if (message.role !== "main") {
      throw new Error(`protocol: hello has role ${JSON.stringify(message.role)}. Only role "main" is known.`);
    }
    return { type: "hello", role: "main" };
  }
  throw new Error(`protocol: unknown message type ${JSON.stringify(message.type)}. Use "hello" or "status".`);
}

export function formatServerMessage(message: ServerMessage): string {
  return `${JSON.stringify(message)}\n`;
}
