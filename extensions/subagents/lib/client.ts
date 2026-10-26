import { createConnection } from "node:net";
import type { Timers } from "./lifecycle.ts";
import { type AgentResult, type ClientMessage, formatClientMessage, parseServerLine, type ServerMessage } from "./protocol.ts";
import type { AgentEntry } from "./register.ts";

export const CLIENT_TIMEOUT_MS = 5000;

export interface Status {
  agents: AgentEntry[];
  main: "connected" | "gone";
}

export interface Client {
  status(): Promise<Status>;
  start(task: string, args: string[], signal?: AbortSignal): Promise<AgentResult>;
  isOpen(): boolean;
  close(): void;
}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export function connectMain(path: string, timers: Timers, timeoutMs = CLIENT_TIMEOUT_MS): Promise<Client> {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection(path);
    let open = false;
    let closed = false;
    let buffer = "";
    let pending: Waiter<ServerMessage> | undefined;
    const starts: Waiter<string>[] = [];
    const results = new Map<string, Waiter<AgentResult>>();

    const connectTimer = timers.setTimeout(() => {
      socket.destroy();
      rejectConnect(
        new Error(`subagents: no connection to the supervisor socket "${path}" within ${timeoutMs} ms. Run "tmux ls" and look at the pi-sub session.`),
      );
    }, timeoutMs);

    function fail(error: Error): void {
      const waiting = pending;
      pending = undefined;
      waiting?.reject(error);
      for (const start of starts.splice(0)) start.reject(error);
      for (const [id, result] of [...results]) {
        results.delete(id);
        result.reject(error);
      }
    }

    function write(message: ClientMessage): void {
      socket.write(formatClientMessage(message));
    }

    function status(): Promise<Status> {
      return new Promise<Status>((resolve, reject) => {
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
            if (message.type === "status") resolve({ agents: message.agents, main: message.main });
            else reject(new Error(`subagents: the supervisor sent "${message.type}" instead of a status.`));
          },
          reject: (error) => {
            timers.clearTimeout(timer);
            reject(error);
          },
        };
        write({ type: "status" });
      });
    }

    function start(task: string, args: string[], signal?: AbortSignal): Promise<AgentResult> {
      return new Promise<AgentResult>((resolve, reject) => {
        if (!open) {
          reject(new Error(`subagents: the connection to "${path}" is closed. Call the tool again to reconnect.`));
          return;
        }
        let id: string | undefined;
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          timers.clearTimeout(timer);
          if (id !== undefined) results.delete(id);
          reject(new Error(`subagents: the wait for subagent ${id ?? "(not started)"} was aborted. The agent keeps running: tmux attach to see it.`));
        };
        const waiter: Waiter<string> = {
          resolve: (started) => {
            timers.clearTimeout(timer);
            if (aborted) return;
            id = started;
            results.set(started, { resolve: end(resolve), reject: end(reject) });
          },
          reject: (error) => {
            timers.clearTimeout(timer);
            if (!aborted) end(reject)(error);
          },
        };
        const timer = timers.setTimeout(() => {
          aborted = true;
          reject(new Error(`subagents: the supervisor at "${path}" did not start the subagent within ${timeoutMs} ms. Read window 0 of the pi-sub session.`));
        }, timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        function end<T>(settle: (value: T) => void): (value: T) => void {
          return (value) => {
            signal?.removeEventListener("abort", onAbort);
            settle(value);
          };
        }
        starts.push(waiter);
        write({ type: "start", task, args });
      });
    }

    function onMessage(message: ServerMessage): void {
      switch (message.type) {
        case "started":
          starts.shift()?.resolve(message.id);
          return;
        case "result": {
          const waiting = results.get(message.id);
          results.delete(message.id);
          waiting?.resolve(message);
          return;
        }
        case "error": {
          const error = new Error(`subagents: the supervisor refused the request: ${message.message}`);
          const waiting = pending ?? starts.shift();
          pending = undefined;
          waiting?.reject(error);
          return;
        }
        case "status": {
          const waiting = pending;
          pending = undefined;
          waiting?.resolve(message);
          return;
        }
        case "task":
          throw new Error('subagents: the supervisor sent a "task" to a main connection. Stop the supervisor and start it again.');
      }
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      timers.clearTimeout(connectTimer);
      open = true;
      write({ type: "hello", role: "main" });
      resolveConnect({ isOpen: () => open, close: () => socket.destroy(), status, start });
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
