import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { socketPath, startSupervisor } from "./server.ts";

const execFileAsync = promisify(execFile);
const timers = { setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout) };

const ID = "abcdef12-0000-4000-8000-000000000000";
const extra = { pi: "pi", extension: fileURLToPath(import.meta.url), newId: () => ID };

function setup() {
  const calls: string[][] = [];
  const tmux = {
    openWindow: async (...args: unknown[]) => {
      calls.push(["open", JSON.stringify(args)]);
      return "@7";
    },
    listWindows: async () => [{ id: "@7", name: "sub-abcd" }],
    setOption: async (...args: string[]) => void calls.push(["set", ...args]),
    killSession: async (...args: string[]) => void calls.push(["kill", ...args]),
  };
  return { calls, tmux };
}

function lines(socket: Socket): () => Promise<unknown> {
  const queue: unknown[] = [];
  let waiting: ((value: unknown) => void) | undefined;
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
      const value = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (waiting) waiting(value);
      else queue.push(value);
      waiting = undefined;
    }
  });
  return () => (queue.length > 0 ? Promise.resolve(queue.shift()) : new Promise((resolve) => (waiting = resolve)));
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path, () => resolve(socket));
    socket.once("error", reject);
  });
}

test("socketPath fails loud without XDG_RUNTIME_DIR", () => {
  assert.throws(() => socketPath(undefined, "abcd1234"), /XDG_RUNTIME_DIR is not set/);
  assert.equal(socketPath("/run/user/1", "abcd1234"), "/run/user/1/pi-sub-abcd1234.sock");
});

test("supervisor: hello, status, bad line, close, shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const { calls, tmux } = setup();
    const dir = join(root, "pi-sub-abcd1234");
    const supervisor = await startSupervisor({ session: "pi-sub-abcd1234", dir, id: "abcd1234", ...extra, runtimeDir: root, tmux, timers });
    assert.deepEqual(calls, [["set", "pi-sub-abcd1234", "@pi-sub-socket", supervisor.path]]);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "register.json"), "utf8")), { agents: [] });

    const client = await connect(supervisor.path);
    const next = lines(client);
    client.write('{"type":"status"}\n');
    assert.deepEqual(await next(), { type: "status", agents: [], main: "gone" });
    client.write('{"type":"hello","role":"main"}\nnot json\n{"type":"status"}\n');
    assert.equal(((await next()) as { type: string }).type, "error");
    assert.deepEqual(await next(), { type: "status", agents: [], main: "connected" });

    client.end();
    await supervisor.done;
    assert.deepEqual(calls[1], ["kill", "pi-sub-abcd1234"]);
    await assert.rejects(stat(supervisor.path), /ENOENT/);
    await stat(join(dir, "register.json"));
  } finally {
    await rm(root, { recursive: true });
  }
});

test("supervisor: stop shuts down without a client", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const { calls, tmux } = setup();
    const supervisor = await startSupervisor({ session: "pi-sub-abcd1234", dir: join(root, "d"), id: "abcd1234", ...extra, runtimeDir: root, tmux, timers });
    await supervisor.stop();
    await supervisor.done;
    assert.equal(calls.at(-1)?.[0], "kill");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("supervisor: a stale socket file is removed, a live one is an error", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const path = socketPath(root, "abcd1234");
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(path, resolve));
    const live = { session: "pi-sub-abcd1234", dir: join(root, "d"), id: "abcd1234", ...extra, runtimeDir: root, tmux: setup().tmux, timers };
    await assert.rejects(startSupervisor(live), /another supervisor answers/);
    await new Promise<void>((resolve) => holder.close(() => resolve()));
    await execFileAsync(process.execPath, [
      "-e",
      `require("node:net").createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, "SIGKILL"))`,
    ]).catch(() => undefined);
    await stat(path);
    const supervisor = await startSupervisor(live);
    await supervisor.stop();
    await supervisor.done;
  } finally {
    await rm(root, { recursive: true });
  }
});

test("supervisor: start, sub hello, task, events, one result to main, immediate shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const { calls, tmux } = setup();
    const dir = join(root, "pi-sub-abcd1234");
    const supervisor = await startSupervisor({ session: "pi-sub-abcd1234", dir, id: "abcd1234", ...extra, runtimeDir: root, tmux, timers });
    const main = await connect(supervisor.path);
    const mainNext = lines(main);
    main.write('{"type":"hello","role":"main"}\n{"type":"start","task":"do it"}\n');
    assert.deepEqual(await mainNext(), { type: "started", id: ID });
    assert.equal(calls.find((call) => call[0] === "open")?.[1]?.includes('"PI_SUBAGENT_ID"'), true);
    assert.equal(JSON.parse(await readFile(join(dir, "register.json"), "utf8")).agents[0].status, "starting");

    const sub = await connect(supervisor.path);
    const subNext = lines(sub);
    sub.write(`{"type":"hello","role":"sub","id":"${ID}"}\n`);
    assert.deepEqual(await subNext(), { type: "task", task: "do it" });
    sub.write('{"type":"event","event":{"kind":"tool_start","name":"bash","args":"{}"}}\n');
    sub.write('{"type":"event","event":{"kind":"message","text":"m","usage":{"tokens":3,"cost":0.1}}}\n');
    main.write('{"type":"status"}\n');
    const status = (await mainNext()) as { agents: { status: string }[] };
    assert.equal(status.agents[0]?.status, "running");
    sub.write('{"type":"event","event":{"kind":"settled","text":"final"}}\n');
    assert.deepEqual(await mainNext(), {
      type: "result",
      id: ID,
      status: "idle",
      text: "final",
      usage: { tokens: 3, cost: 0.1 },
      events: ["tool bash {}", "message m", "settled final"],
    });

    main.end();
    await supervisor.done;
    assert.equal(JSON.parse(await readFile(join(dir, "register.json"), "utf8")).agents[0].status, "idle");
    assert.deepEqual(calls.at(-1), ["kill", "pi-sub-abcd1234"]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("supervisor: main gone while an agent runs; the supervisor ends when the agent settles", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const { calls, tmux } = setup();
    const supervisor = await startSupervisor({ session: "pi-sub-abcd1234", dir: join(root, "d"), id: "abcd1234", ...extra, runtimeDir: root, tmux, timers });
    const main = await connect(supervisor.path);
    const mainNext = lines(main);
    main.write('{"type":"hello","role":"main"}\n{"type":"start","task":"t"}\n');
    await mainNext();
    const sub = await connect(supervisor.path);
    const subNext = lines(sub);
    sub.write(`{"type":"hello","role":"sub","id":"${ID}"}\n`);
    await subNext();
    main.end();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      calls.some((call) => call[0] === "kill"),
      false,
    );
    sub.write('{"type":"event","event":{"kind":"settled","text":"x"}}\n');
    await supervisor.done;
    assert.deepEqual(calls.at(-1), ["kill", "pi-sub-abcd1234"]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("supervisor: wrong roles and unknown ids get an error message", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const { tmux } = setup();
    const supervisor = await startSupervisor({ session: "pi-sub-abcd1234", dir: join(root, "d"), id: "abcd1234", ...extra, runtimeDir: root, tmux, timers });
    const client = await connect(supervisor.path);
    const next = lines(client);
    for (const [line, pattern] of [
      ['{"type":"start","task":"t"}', /only a connection with hello role "main"/],
      ['{"type":"event","event":{"kind":"settled","text":""}}', /only a connection with hello role "sub"/],
      ['{"type":"hello","role":"sub","id":"nope"}', /no subagent with id "nope"/],
    ] as const) {
      client.write(`${line}\n`);
      const reply = (await next()) as { type: string; message: string };
      assert.equal(reply.type, "error");
      assert.match(reply.message, pattern);
    }
    await supervisor.stop();
    await supervisor.done;
  } finally {
    await rm(root, { recursive: true });
  }
});

test("supervisor: an extension path that does not exist fails at start", async () => {
  const root = await mkdtemp(join(tmpdir(), "sup-"));
  try {
    const { tmux } = setup();
    await assert.rejects(
      startSupervisor({
        session: "pi-sub-abcd1234",
        dir: join(root, "d"),
        id: "abcd1234",
        ...extra,
        extension: "/nope/index.ts",
        runtimeDir: root,
        tmux,
        timers,
      }),
      /extension "\/nope\/index.ts" is not readable/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
