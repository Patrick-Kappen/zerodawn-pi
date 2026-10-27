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
  start(task: string, args: string[], checks: string[], models: string[], source: Source, signal?: AbortSignal): Promise<AgentResult>;
  begin(task: string, args: string[], checks: string[], models: string[], source: Source): Promise<string>;
  discard(id: string): Promise<string>;
  answer(id: string, text: string, signal?: AbortSignal): Promise<AgentResult>;
  isOpen(): boolean;
  close(): void;
}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

type Kind = "start" | "status" | "discard" | "answer";

interface Request extends Waiter<ServerMessage> {
  kind: Kind;
}

export function connectMain(path: string, timers: Timers, timeoutMs = CLIENT_TIMEOUT_MS): Promise<Client> {
  return new Promise((resolveConnect, rejectConnect) => {
    const socket = createConnection(path);
    let open = false;
    let closed = false;
    let buffer = "";
    let counter = 0;
    const requests = new Map<string, Request>();
    const results = new Map<string, Waiter<AgentResult>>();

    const connectTimer = timers.setTimeout(() => {
      socket.destroy();
      rejectConnect(
        new Error(`subagents: no connection to the supervisor socket "${path}" within ${timeoutMs} ms. Run "tmux ls" and look at the pi-sub session.`),
      );
    }, timeoutMs);

    function fail(error: Error): void {
      for (const [requestId, request] of [...requests]) {
        requests.delete(requestId);
        request.reject(new Error(`subagents: the ${request.kind} request failed: ${error.message}`, { cause: error }));
      }
      for (const [id, result] of [...results]) {
        results.delete(id);
        result.reject(error);
      }
    }

    function write(message: ClientMessage): void {
      socket.write(formatClientMessage(message));
    }

    function status(): Promise<Status> {
      return exchange(
        "status",
        "gave no status",
        (requestId) => ({ type: "status", requestId }),
        (message) => (message.type === "status" ? { agents: message.agents, main: message.main } : undefined),
      );
    }

    function discard(id: string): Promise<string> {
      return exchange(
        "discard",
        "gave no answer to the discard",
        (requestId) => ({ type: "discard", requestId, id }),
        (message) => (message.type === "discarded" ? message.text : undefined),
      );
    }

    // A request with one answer, matched by requestId; accept gives undefined for a message of another type.
    // onValue runs in the same tick as the answer: a result in the same chunk must find its waiter.
    function exchange<T>(
      kind: Kind,
      what: string,
      build: (requestId: string) => ClientMessage,
      accept: (message: ServerMessage) => T | undefined,
      onValue?: (value: T) => void,
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (!open) {
          reject(new Error(`subagents: the connection to "${path}" is closed. Call the tool again to reconnect.`));
          return;
        }
        counter += 1;
        const requestId = String(counter);
        const timer = timers.setTimeout(() => {
          requests.delete(requestId);
          reject(
            new Error(
              `subagents: the supervisor at "${path}" ${what} within ${timeoutMs} ms (${kind} request). Run "tmux attach" to the pi-sub session and read window 0.`,
            ),
          );
        }, timeoutMs);
        requests.set(requestId, {
          kind,
          resolve: (message) => {
            timers.clearTimeout(timer);
            const value = accept(message);
            if (value !== undefined) {
              onValue?.(value);
              resolve(value);
            } else reject(new Error(`subagents: the supervisor sent "${message.type}" to the ${kind} request. Stop the supervisor and start it again.`));
          },
          reject: (error) => {
            timers.clearTimeout(timer);
            reject(error);
          },
        });
        write(build(requestId));
      });
    }

    function start(task: string, args: string[], checks: string[], models: string[], source: Source, signal?: AbortSignal): Promise<AgentResult> {
      return run("start", (requestId) => ({ type: "start", requestId, task, args, checks, models, repo: source.repo, sha: source.sha }), signal);
    }

    // Starts an agent and returns its id at once; the result message is not awaited.
    function begin(task: string, args: string[], checks: string[], models: string[], source: Source): Promise<string> {
      return accepted("start", (requestId) => ({ type: "start", requestId, task, args, checks, models, repo: source.repo, sha: source.sha }));
    }

    function accepted(kind: "start" | "answer", build: (requestId: string) => ClientMessage, onStarted?: (id: string) => void): Promise<string> {
      return exchange(kind, "did not start the subagent", build, (message) => (message.type === "started" ? message.id : undefined), onStarted);
    }

    function answer(id: string, text: string, signal?: AbortSignal): Promise<AgentResult> {
      return run("answer", (requestId) => ({ type: "answer", requestId, id, text }), signal);
    }

    // The supervisor accepts a start or an answer with "started"; the result follows.
    function run(kind: "start" | "answer", build: (requestId: string) => ClientMessage, signal?: AbortSignal): Promise<AgentResult> {
      return new Promise<AgentResult>((resolve, reject) => {
        let id: string | undefined;
        let aborted = false;
        const onAbort = () => {
          aborted = true;
          if (id !== undefined) results.delete(id);
          reject(new Error(`subagents: the wait for subagent ${id ?? "(not started)"} was aborted. The agent keeps running: tmux attach to see it.`));
        };
        function end<T>(settle: (value: T) => void): (value: T) => void {
          return (value) => {
            signal?.removeEventListener("abort", onAbort);
            settle(value);
          };
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        accepted(kind, build, (started) => {
          if (aborted) return;
          id = started;
          results.set(started, { resolve: end(resolve), reject: end(reject) });
        }).then(
          () => {},
          (error: Error) => {
            if (!aborted) end(reject)(error);
          },
        );
      });
    }

    function onMessage(message: ServerMessage): void {
      switch (message.type) {
        case "result": {
          const waiting = results.get(message.id);
          results.delete(message.id);
          waiting?.resolve(message);
          return;
        }
        case "error": {
          if (message.requestId === undefined) {
            throw new Error(`subagents: the supervisor refused a message: ${message.message}. Stop the supervisor and start it again.`);
          }
          const request = take(message.requestId, message.type);
          request.reject(new Error(`subagents: the supervisor refused the ${request.kind} request: ${message.message}`));
          return;
        }
        case "started":
        case "status":
        case "discarded":
          take(message.requestId, message.type).resolve(message);
          return;
        case "task":
          throw new Error('subagents: the supervisor sent a "task" to a main connection. Stop the supervisor and start it again.');
      }
    }

    function take(requestId: string, type: string): Request {
      const request = requests.get(requestId);
      if (request === undefined) {
        throw new Error(`protocol: the supervisor sent "${type}" with the unknown requestId "${requestId}". Stop the supervisor and start it again.`);
      }
      requests.delete(requestId);
      return request;
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
