import { unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { createLifecycle, GRACE_MS, type Timers } from "./lifecycle.ts";
import { formatServerMessage, parseClientLine, type ServerMessage } from "./protocol.ts";
import { type AgentEntry, writeRegister } from "./register.ts";

export interface Tmux {
  setOption(session: string, option: string, value: string): Promise<void>;
  killSession(session: string): Promise<void>;
}

export interface SupervisorOptions {
  session: string;
  dir: string;
  id: string;
  runtimeDir: string | undefined;
  tmux: Tmux;
  timers: Timers;
  graceMs?: number;
}

export function socketPath(runtimeDir: string | undefined, id: string): string {
  if (runtimeDir === undefined || runtimeDir === "") {
    throw new Error("supervisor: XDG_RUNTIME_DIR is not set. Log in with a systemd user session or set it to a user-owned directory.");
  }
  return join(runtimeDir, `pi-sub-${id}.sock`);
}

function answers(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createConnection(path);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else if (error.code === "ENOENT") resolve(false);
      else
        reject(new Error(`supervisor: could not probe socket "${path}": ${error.message}. Remove the file by hand when no supervisor runs.`, { cause: error }));
    });
  });
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

export async function startSupervisor(options: SupervisorOptions) {
  const path = socketPath(options.runtimeDir, options.id);
  const agents: AgentEntry[] = [];
  const clients = new Set<Socket>();
  let server: Server | undefined;
  let stopping: Promise<void> | undefined;
  let resolveDone: () => void = () => {};
  let rejectDone: (error: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function shutdown(): Promise<void> {
    stopping ??= (async () => {
      const closed = new Promise<void>((resolve) => (server as Server).close(() => resolve()));
      for (const client of clients) client.destroy();
      await closed;
      await removeFile(path);
      await options.tmux.killSession(options.session);
    })();
    return stopping;
  }

  const lifecycle = createLifecycle({
    timers: options.timers,
    graceMs: options.graceMs ?? GRACE_MS,
    agentsRunning: () => agents.some((agent) => agent.status === "running"),
    shutdown: () => {
      shutdown().then(resolveDone, (cause) =>
        rejectDone(new Error("supervisor: shutdown failed. Remove the socket file and the tmux session by hand.", { cause })),
      );
    },
  });

  function send(socket: Socket, message: ServerMessage): void {
    socket.write(formatServerMessage(message));
  }

  function onConnection(socket: Socket): void {
    clients.add(socket);
    let isMain = false;
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
          const message = parseClientLine(line);
          if (message.type === "hello") {
            if (!isMain) {
              isMain = true;
              lifecycle.mainOpened();
            }
          } else {
            send(socket, { type: "status", agents, main: lifecycle.isMainConnected() ? "connected" : "gone" });
          }
        } catch (error) {
          send(socket, { type: "error", message: (error as Error).message });
        }
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clients.delete(socket);
      if (isMain && stopping === undefined) lifecycle.mainClosed();
    });
  }

  await freeSocket(path);
  await writeRegister(options.dir, agents);
  server = createServer(onConnection);
  await new Promise<void>((resolve, reject) => {
    (server as Server).once("error", reject);
    (server as Server).listen(path, resolve);
  });
  await options.tmux.setOption(options.session, "@pi-sub-socket", path);

  return { path, done, stop: () => shutdown().then(resolveDone, rejectDone) };
}
