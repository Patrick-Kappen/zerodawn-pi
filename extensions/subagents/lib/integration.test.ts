import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectMain } from "./client.ts";
import { ensureSupervisor } from "./ensure.ts";
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

after(async () => {
  await exec("tmux", ["-L", socket, "kill-server"]);
  await rm(`/tmp/${sessionName(sessionId)}`, { recursive: true, force: true });
});

test("real supervisor: ensure, hello, status, close, session ends", { timeout: 30_000 }, async () => {
  const tmux = createTmux(exec, socket);
  const { session, socket: path } = await ensureSupervisor({
    tmux,
    timers,
    sessionId,
    supervisorPath: fileURLToPath(new URL("../supervisor.ts", import.meta.url)),
    execPath: process.execPath,
    runtimeRoot: "/tmp",
  });
  assert.equal(session, sessionName(sessionId));
  const client = await connectMain(path, timers);
  const status = await client.status();
  assert.equal(status.main, "connected");
  assert.deepEqual(status.agents, []);
  client.close();
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});
