import type { ClientMessage, ServerMessage } from "./protocol.ts";

export const MAX_FIELD = 200;

export interface SubEnv {
  socket: string;
  id: string;
}

export function readSubEnv(env: Record<string, string | undefined>): SubEnv | undefined {
  const socket = env.PI_SUBAGENT_SOCKET;
  const id = env.PI_SUBAGENT_ID;
  if (socket === undefined && id === undefined) return undefined;
  if (socket === undefined || socket === "" || id === undefined || id === "") {
    throw new Error("subagents: set both PI_SUBAGENT_SOCKET and PI_SUBAGENT_ID, or neither. The supervisor sets both for a subagent.");
  }
  return { socket, id };
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

export interface SubHandlerOptions {
  send: (message: ClientMessage) => void;
  sendUserMessage: (text: string) => void;
}

export function createSubHandlers(options: SubHandlerOptions) {
  let lastText = "";
  return {
    onServerMessage(message: ServerMessage): void {
      if (message.type === "task") options.sendUserMessage(message.task);
      else if (message.type === "error") throw new Error(`subagents: the supervisor refused the request: ${message.message}`);
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
      options.send({ type: "ask", text: question });
      return "Your question went to the main agent. Stop now and wait for a new message with the answer.";
    },
    blocker(reason: string): string {
      options.send({ type: "blocker", text: reason });
      return "Your blocker went to the main agent. Stop now and wait for a new message.";
    },
    settled(): void {
      options.send({ type: "event", event: { kind: "settled", text: lastText } });
      lastText = "";
    },
  };
}
