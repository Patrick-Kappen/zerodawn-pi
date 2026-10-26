import { createConnection } from "node:net";
import { type ClientMessage, formatClientMessage, parseServerLine, type ServerMessage } from "./protocol.ts";
import type { SubEnv } from "./sub.ts";

export interface SubConnection {
  send(message: ClientMessage): void;
  close(): void;
}

export function connectSub(env: SubEnv, onMessage: (message: ServerMessage) => void, onError: (error: Error) => void): Promise<SubConnection> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(env.socket);
    let open = false;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      open = true;
      const send = (message: ClientMessage) => socket.write(formatClientMessage(message));
      send({ type: "hello", role: "sub", id: env.id });
      resolve({ send, close: () => socket.destroy() });
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim() === "") continue;
        try {
          onMessage(parseServerLine(line));
        } catch (error) {
          onError(error as Error);
        }
      }
    });
    socket.on("error", (cause: NodeJS.ErrnoException) => {
      const error = new Error(`subagents: the connection to "${env.socket}" failed: ${cause.message}. Make sure the supervisor runs: "tmux ls".`, { cause });
      if (open) onError(error);
      else reject(error);
    });
    socket.on("close", () => {
      if (open) onError(new Error(`subagents: the supervisor closed the connection "${env.socket}". This subagent cannot report any more.`));
    });
  });
}
