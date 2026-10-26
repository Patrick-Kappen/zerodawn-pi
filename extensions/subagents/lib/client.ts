import { createConnection } from "node:net";
import type { Timers } from "./lifecycle.ts";
import { type ClientMessage, parseServerLine, type ServerMessage } from "./protocol.ts";
import type { AgentEntry } from "./register.ts";

export const CLIENT_TIMEOUT_MS = 5000;

export interface Status {
  agents: AgentEntry[];
  main: "connected" | "gone";
}

export interface Client {
  status(): Promise<Status>;
  isOpen(): boolean;
  close(): void;
}

export function connectMain(path: string, timers: Timers, timeoutMs = CLIENT_TIMEOUT_MS): Promise<Client> {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection(path);
    let open = false;
    let closed = false;
    let buffer = "";
    let pending: { resolve: (message: ServerMessage) => void; reject: (error: Error) => void } | undefined;

    const connectTimer = timers.setTimeout(() => {
      socket.destroy();
      rejectConnect(
        new Error(`subagents: no connection to the supervisor socket "${path}" within ${timeoutMs} ms. Run "tmux ls" and look at the pi-sub session.`),
      );
    }, timeoutMs);

    function fail(error: Error): void {
      if (pending !== undefined) {
        const waiting = pending;
        pending = undefined;
        waiting.reject(error);
      }
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      timers.clearTimeout(connectTimer);
      open = true;
      socket.write(`${JSON.stringify({ type: "hello", role: "main" } satisfies ClientMessage)}\n`);
      resolveConnect({
        isOpen: () => open,
        close: () => socket.destroy(),
        status: () =>
          new Promise<Status>((resolve, reject) => {
            if (!open) {
              reject(new Error(`subagents: the connection to "${path}" is closed. Call the tool again to reconnect.`));
              return;
            }
            if (pending !== undefined) {
              reject(new Error("subagents: a status request is already waiting. Wait for it to end."));
              return;
            }
            const timer = timers.setTimeout(() => {
              pending = undefined;
              reject(
                new Error(
                  `subagents: the supervisor at "${path}" gave no status within ${timeoutMs} ms. Run "tmux attach" to the pi-sub session and read window 0.`,
                ),
              );
            }, timeoutMs);
            pending = {
              resolve: (message) => {
                timers.clearTimeout(timer);
                if (message.type === "error") reject(new Error(`subagents: the supervisor refused the request: ${message.message}`));
                else resolve({ agents: message.agents, main: message.main });
              },
              reject: (error) => {
                timers.clearTimeout(timer);
                reject(error);
              },
            };
            socket.write(`${JSON.stringify({ type: "status" } satisfies ClientMessage)}\n`);
          }),
      });
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line.trim() === "") continue;
        try {
          const message = parseServerLine(line);
          const waiting = pending;
          pending = undefined;
          waiting?.resolve(message);
        } catch (error) {
          fail(error as Error);
        }
      }
    });
    socket.on("error", (cause: NodeJS.ErrnoException) => {
      const error = new Error(`subagents: the connection to "${path}" failed: ${cause.message}. Make sure the supervisor runs: "tmux ls".`, { cause });
      if (!open) {
        timers.clearTimeout(connectTimer);
        rejectConnect(error);
      } else fail(error);
    });
    socket.on("close", () => {
      if (closed) return;
      closed = true;
      const wasOpen = open;
      open = false;
      fail(new Error(`subagents: the supervisor closed the connection "${path}". Call the tool again to start a new one.`));
      if (!wasOpen) timers.clearTimeout(connectTimer);
    });
  });
}
