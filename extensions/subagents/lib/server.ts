import { stat, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { createAgents } from "./agents.ts";
import { createLifecycle, GRACE_MS, type Timers } from "./lifecycle.ts";
import { answers } from "./probe.ts";
import { formatServerMessage, parseClientLine, type ServerMessage } from "./protocol.ts";
import { writeRegister } from "./register.ts";
import type { Tmux as FullTmux } from "./tmux.ts";

export type Tmux = Pick<FullTmux, "setOption" | "killSession" | "openWindow" | "listWindows">;

export interface SupervisorOptions {
  session: string;
  dir: string;
  id: string;
  pi: string;
  extensions: string[];
  newId: () => string;
  runtimeDir: string | undefined;
  tmux: Tmux;
  timers: Timers;
  graceMs?: number;
  helloTimeoutMs?: number;
  pollMs?: number;
}

export function socketPath(runtimeDir: string | undefined, id: string): string {
  if (runtimeDir === undefined || runtimeDir === "") {
    throw new Error("supervisor: XDG_RUNTIME_DIR is not set. Log in with a systemd user session or set it to a user-owned directory.");
  }
  return join(runtimeDir, `pi-sub-${id}.sock`);
}

async function removeFile(path: string): Promise<void> {
  try {
    // net.Server.close() may already have removed the socket file
    await unlink(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`supervisor: could not remove stale socket "${path}". Remove it by hand.`, { cause });
    }
  }
}

async function freeSocket(path: string): Promise<void> {
  if (await answers(path)) {
    throw new Error(`supervisor: another supervisor answers on "${path}". Stop it, or use the running one.`);
  }
  await removeFile(path);
}

async function checkExtension(path: string, index: number): Promise<void> {
  const next = index === 0 ? "Give the absolute path of extensions/subagents/index.ts." : 'Fix "subagentExtensions" in config.json.';
  try {
    await stat(path);
  } catch (cause) {
    throw new Error(`supervisor: extension "${path}" is not readable. ${next}`, { cause });
  }
}

interface Connection {
  role?: "main" | "sub";
  id?: string;
}

export async function startSupervisor(options: SupervisorOptions) {
  const path = socketPath(options.runtimeDir, options.id);
  const clients = new Set<Socket>();
  const mains = new Set<Socket>();
  const subs = new Map<string, Socket>();
  let server: Server | undefined;
  let stopping: Promise<void> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let resolveDone: () => void = () => {};
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function shutdown(): Promise<void> {
    stopping ??= (async () => {
      agents.dispose();
      const closed = new Promise<void>((resolve) => (server as Server).close(() => resolve()));
      for (const client of clients) client.destroy();
      await closed;
      await writing;
      await removeFile(path);
      await options.tmux.killSession(options.session);
    })();
    return stopping;
  }

  const lifecycle = createLifecycle({
    timers: options.timers,
    graceMs: options.graceMs ?? GRACE_MS,
    agentsRunning: () => agents.running(),
    shutdown: () => {
      shutdown().then(resolveDone, (cause) =>
        rejectDone(new Error("supervisor: shutdown failed. Remove the socket file and the tmux session by hand.", { cause })),
      );
    },
  });

  function send(socket: Socket, message: ServerMessage): void {
    if (!socket.destroyed) socket.write(formatServerMessage(message));
  }

  function persist(): void {
    writing = writing.then(() => writeRegister(options.dir, agents.entries())).catch(rejectDone);
  }

  const agents = createAgents({
    session: options.session,
    dir: options.dir,
    socket: path,
    piCommand: options.pi,
    extensions: options.extensions,
    tmux: options.tmux,
    timers: options.timers,
    newId: options.newId,
    sendToSub: (id, message) => {
      const socket = subs.get(id);
      if (socket === undefined) throw new Error(`supervisor: subagent ${id} has no connection. Run: tmux attach -t ${options.session}`);
      send(socket, message);
    },
    // After the queued register write: a main that reads register.json after a result sees the same state.
    sendToMains: (message) => {
      writing = writing.then(() => {
        for (const socket of mains) send(socket, message);
      });
    },
    onChange: () => {
      persist();
      lifecycle.agentsChanged();
    },
    onError: (error) => rejectDone(error),
    helloTimeoutMs: options.helloTimeoutMs,
    pollMs: options.pollMs,
  });

  function handle(socket: Socket, connection: Connection, line: string): void {
    const message = parseClientLine(line);
    switch (message.type) {
      case "hello": {
        if (connection.role !== undefined) throw new Error("supervisor: this connection already said hello.");
        if (message.role === "main") {
          connection.role = "main";
          mains.add(socket);
          lifecycle.mainOpened();
          return;
        }
        subs.set(message.id, socket);
        try {
          agents.hello(message.id);
        } catch (error) {
          subs.delete(message.id);
          throw error;
        }
        connection.role = "sub";
        connection.id = message.id;
        return;
      }
      case "status":
        send(socket, { type: "status", agents: agents.entries(), main: lifecycle.isMainConnected() ? "connected" : "gone" });
        return;
      case "start":
        if (connection.role !== "main") throw new Error('supervisor: only a connection with hello role "main" can start a subagent.');
        agents.start(message.task).then(
          async (id) => {
            await writing;
            send(socket, { type: "started", id });
          },
          (error: Error) => send(socket, { type: "error", message: error.message }),
        );
        return;
      case "event":
        if (connection.role !== "sub" || connection.id === undefined) throw new Error('supervisor: only a connection with hello role "sub" can send events.');
        agents.event(connection.id, message.event);
        return;
    }
  }

  function onConnection(socket: Socket): void {
    clients.add(socket);
    const connection: Connection = {};
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.trim() === "") continue;
        try {
          handle(socket, connection, line);
        } catch (error) {
          send(socket, { type: "error", message: (error as Error).message });
        }
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clients.delete(socket);
      if (connection.role === "sub" && connection.id !== undefined) subs.delete(connection.id);
      if (connection.role === "main") {
        mains.delete(socket);
        if (stopping === undefined) lifecycle.mainClosed();
      }
    });
  }

  for (const [index, path] of options.extensions.entries()) await checkExtension(path, index);
  await freeSocket(path);
  persist();
  await writing;
  server = createServer(onConnection);
  await new Promise<void>((resolve, reject) => {
    (server as Server).once("error", reject);
    (server as Server).listen(path, resolve);
  });
  await options.tmux.setOption(options.session, "@pi-sub-socket", path);

  return { path, done, stop: () => shutdown().then(resolveDone, rejectDone) };
}
