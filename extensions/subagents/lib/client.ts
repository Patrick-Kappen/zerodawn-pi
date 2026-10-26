import { createConnection } from "node:net";
import type { Source } from "./git.ts";
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
  start(task: string, args: string[], checks: string[], source: Source, signal?: AbortSignal): Promise<AgentResult>;
  begin(task: string, args: string[], checks: string[], source: Source): Promise<string>;
  discard(id: string): Promise<string>;
  answer(id: string, text: string, signal?: AbortSignal): Promise<AgentResult>;
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
      return exchange({ type: "status" }, "status", (message) => (message.type === "status" ? { agents: message.agents, main: message.main } : undefined));
    }

    function discard(id: string): Promise<string> {
      return exchange({ type: "discard", id }, "answer to the discard", (message) => (message.type === "discarded" ? message.text : undefined));
    }

    // A request with one answer; accept gives undefined for a message of another type.
    function exchange<T>(request: ClientMessage, what: string, accept: (message: ServerMessage) => T | undefined): Promise<T> {
      return new Promise<T>((resolve, reject) => {
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
              `subagents: the supervisor at "${path}" gave no ${what} within ${timeoutMs} ms. Run "tmux attach" to the pi-sub session and read window 0.`,
            ),
          );
        }, timeoutMs);
        pending = {
          resolve: (message) => {
            timers.clearTimeout(timer);
            const value = accept(message);
            if (value !== undefined) resolve(value);
            else reject(new Error(`subagents: the supervisor sent "${message.type}" instead of the ${what}.`));
          },
          reject: (error) => {
            timers.clearTimeout(timer);
            reject(error);
          },
        };
        write(request);
      });
    }

    function start(task: string, args: string[], checks: string[], source: Source, signal?: AbortSignal): Promise<AgentResult> {
      return run({ type: "start", task, args, checks, repo: source.repo, sha: source.sha }, signal);
    }

    // Starts an agent and returns its id at once; the result message is not awaited.
    function begin(task: string, args: string[], checks: string[], source: Source): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        if (!open) {
          reject(new Error(`subagents: the connection to "${path}" is closed. Call the tool again to reconnect.`));
          return;
        }
        const timer = timers.setTimeout(
          () =>
            reject(new Error(`subagents: the supervisor at "${path}" did not start the subagent within ${timeoutMs} ms. Read window 0 of the pi-sub session.`)),
          timeoutMs,
        );
        starts.push({
          resolve: (id) => {
            timers.clearTimeout(timer);
            resolve(id);
          },
          reject: (error) => {
            timers.clearTimeout(timer);
            reject(error);
          },
        });
        write({ type: "start", task, args, checks, repo: source.repo, sha: source.sha });
      });
    }

    function answer(id: string, text: string, signal?: AbortSignal): Promise<AgentResult> {
      return run({ type: "answer", id, text }, signal);
    }

    // The supervisor accepts a start or an answer with "started"; the result follows.
    function run(message: ClientMessage, signal?: AbortSignal): Promise<AgentResult> {
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
        write(message);
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
        case "status":
        case "discarded": {
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
      resolveConnect({ isOpen: () => open, close: () => socket.destroy(), status, start, begin, discard, answer });
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
