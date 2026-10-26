import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, readFile, rm } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectMain } from "./client.ts";
import { ensureSupervisor } from "./ensure.ts";
import { answers } from "./probe.ts";
import { shapeResult } from "./result.ts";
import { createTmux, type Exec, sessionName } from "./tmux.ts";

const socket = `pi-subagents-test-${process.pid}`;
const exec: Exec = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 127;
      resolve({ stdout, stderr, code, killed: false });
    });
  });
const timers = { setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout) };
const sessionId = randomUUID();
const fakePi = fileURLToPath(new URL("./fixtures/fake-pi.mjs", import.meta.url));
const supervisorPath = fileURLToPath(new URL("../supervisor.ts", import.meta.url));
const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const sessionIds = [sessionId];

after(async () => {
  await exec("tmux", ["-L", socket, "kill-server"]);
  for (const id of sessionIds) await rm(`/tmp/${sessionName(id)}`, { recursive: true, force: true });
});

function ensure(id: string, piCommand: string) {
  return ensureSupervisor({
    tmux: createTmux(exec, socket),
    probe: answers,
    timers,
    sessionId: id,
    supervisorPath,
    execPath: process.execPath,
    piCommand,
    extensionPaths: [extensionPath],
    runtimeRoot: "/tmp",
  });
}

test("real supervisor: ensure, hello, status, close, session ends", { timeout: 30_000 }, async () => {
  const tmux = createTmux(exec, socket);
  const { session, socket: path } = await ensure(sessionId, "pi");
  assert.equal(session, sessionName(sessionId));
  const client = await connectMain(path, timers);
  const status = await client.status();
  assert.equal(status.main, "connected");
  assert.deepEqual(status.agents, []);
  client.close();
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor with a fake pi: one small result reaches main, the session ends", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  await chmod(fakePi, 0o755);
  const tmux = createTmux(exec, socket);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const result = await client.start("say hi");
  assert.equal(result.status, "idle");
  assert.equal(result.text, "answer to: say hi");
  assert.deepEqual(result.usage, { tokens: 7, cost: 0.01 });
  assert.equal(result.events.length, 4);
  const shaped = shapeResult(result);
  assert.equal(shaped.content.length, 1);
  assert.equal(shaped.content[0].text, `agent ${result.id}\nstatus: idle\nanswer to: say hi\n7 tokens, $0.0100`);
  const register = JSON.parse(await readFile(`/tmp/${session}/register.json`, "utf8"));
  assert.deepEqual(
    register.agents.map((agent: { id: string; status: string }) => [agent.id, agent.status]),
    [[result.id, "idle"]],
  );
  client.close();
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor: a command that dies without a hello is reported as failed", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, "false");
  const client = await connectMain(path, timers);
  const result = await client.start("t");
  assert.equal(result.status, "failed");
  assert.match(result.text, /window .* is gone.*tmux attach -t/);
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});
