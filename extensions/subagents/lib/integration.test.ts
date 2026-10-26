import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectMain } from "./client.ts";
import { ensureSupervisor } from "./ensure.ts";
import { resolveBase } from "./git.ts";
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
const fakePiScript = fileURLToPath(new URL("./fixtures/fake-pi.ts", import.meta.url));
// The Nix test sandbox has no XDG_RUNTIME_DIR, no node and no /usr/bin/env: give the tmux server its own runtime dir,
// and start the fake pi through /bin/sh with the runtime of this test.
const work = await mkdtemp(join(tmpdir(), "pi-subagents-it-"));
process.env.XDG_RUNTIME_DIR = work;
// The supervisor puts worktrees under ~/.worktrees: a temp HOME keeps them in the temp dir.
process.env.HOME = work;
const repo = join(await realpath(work), "proj");
await mkdir(repo);
async function git(...args: string[]): Promise<string> {
  const result = await exec("git", ["-C", repo, ...args]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}
await git("init", "-q", "-b", "main");
await git("config", "user.email", "t@example.com");
await git("config", "user.name", "T");
await writeFile(join(repo, "a.txt"), "a\n");
await git("add", "-A");
await git("commit", "-q", "-m", "first");
await git("branch", "base-branch");
await writeFile(join(repo, "b.txt"), "b\n");
await git("add", "-A");
await git("commit", "-q", "-m", "second");
const source = await resolveBase(exec, repo);
const tree = (id: string) => join(work, ".worktrees", "proj", `sub-${id.slice(0, 8)}`);
const fakePi = join(work, "fake-pi");
await writeFile(fakePi, `#!/bin/sh\nexec "${process.execPath}" "${fakePiScript}" "$@"\n`);
await chmod(fakePi, 0o755);
const supervisorPath = fileURLToPath(new URL("../supervisor.ts", import.meta.url));
const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const sessionIds = [sessionId];

after(async () => {
  await exec("tmux", ["-L", socket, "kill-server"]);
  for (const id of sessionIds) await rm(`/tmp/${sessionName(id)}`, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
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
  const tmux = createTmux(exec, socket);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const result = await client.start("say hi", ["--no-tools"], [], source);
  assert.equal(result.status, "idle");
  assert.equal(result.text, "answer to: say hi\na.ts:1 fact\ntests: not run: no changed files");
  assert.deepEqual(result.usage, { tokens: 7, cost: 0.01 });
  assert.equal(result.events.length, 3);
  const shaped = shapeResult(result);
  assert.equal(shaped.content.length, 1);
  assert.equal(shaped.content[0].text, `agent ${result.id}\nstatus: idle\nanswer to: say hi\na.ts:1 fact\ntests: not run: no changed files\n7 tokens, $0.0100`);
  const register = JSON.parse(await readFile(`/tmp/${session}/register.json`, "utf8"));
  assert.deepEqual(
    register.agents.map((agent: { id: string; status: string }) => [agent.id, agent.status]),
    [[result.id, "idle"]],
  );
  client.close();
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor with a fake pi: ask gives question, answer gives idle", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const asked = await client.start("ASK", ["--no-tools"], [], source);
  assert.equal(asked.status, "question");
  assert.equal(asked.text, "which db?");
  assert.equal(
    shapeResult(asked).content[0].text,
    `agent ${asked.id}\nstatus: question\nwhich db?\nworktree: ${tree(asked.id)}\nbranch: sub/${asked.id.slice(0, 8)}`,
  );
  await assert.rejects(client.answer("nope", "x"), /no subagent/);
  const answered = await client.answer(asked.id, "sqlite");
  assert.equal(answered.status, "idle");
  assert.equal(answered.text, "answer to: sqlite\na.ts:1 fact\ntests: not run: no changed files");
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor with a fake pi: blocker and handoff data reach main", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const blocked = await client.start("BLOCK", ["--no-tools"], [], source);
  assert.equal(blocked.status, "blocked");
  assert.deepEqual(blocked.blocker, { issue: "no access", files: ["x.ts", "y.ts"], tried: ["a", "b"] });
  assert.equal(
    shapeResult(blocked).content[0].text,
    `agent ${blocked.id}\nstatus: blocked\nno access\nfiles: x.ts, y.ts\ntried: a; b\nworktree: ${tree(blocked.id)}\nbranch: sub/${blocked.id.slice(0, 8)}`,
  );
  const handed = await client.start("HANDOFF", ["--no-tools"], [], source);
  assert.equal(handed.status, "handoff");
  assert.equal(handed.handoff?.summary, "token limit");
  assert.equal(handed.gate, undefined);
  assert.equal(handed.text, "token limit\na.ts:1 fact\nopen: b\nnext: c");
  assert.deepEqual(shapeResult(handed).details.handoff, handed.handoff);
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor with a fake pi: handoff data and gate reach main", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const result = await client.start("CHANGES", ["--no-tools"], [], source);
  assert.equal(result.status, "idle");
  assert.equal(result.text, "It works.\na.ts: w\ntests: green: 2 pass, 0 fail; added: a.test.ts\ndecisions: d");
  assert.deepEqual(result.gate, { ok: true, files: ["a.ts", "a.test.ts"], tests: "green: 2 pass, 0 fail" });
  const shaped = shapeResult(result);
  assert.deepEqual([shaped.details.handoff, shaped.details.gate], [result.handoff, result.gate]);
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor: a command that dies without a hello is reported as failed", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, "false");
  const client = await connectMain(path, timers);
  const result = await client.start("t", ["--no-tools"], [], source);
  assert.equal(result.status, "failed");
  assert.match(result.text, /window .* is gone.*tmux attach -t/);
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor with a fake pi: worktree on the base, commit with trailer, discard", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const base = await resolveBase(exec, repo, "base-branch");
  const result = await client.start("WRITE", ["--no-tools"], [], base);
  const short = result.id.slice(0, 8);
  const worktree = join(work, ".worktrees", "proj", `sub-${short}`);
  assert.equal(result.status, "idle");
  assert.deepEqual([result.worktree, result.branch], [worktree, `sub/${short}`]);
  assert.match(
    shapeResult(result).content[0].text,
    new RegExp(`worktree: ${worktree}\nbranch: sub/${short}\ncommit: ${(await git("rev-parse", `sub/${short}`)).slice(0, 7)} scope: wrote a file\n`),
  );
  assert.equal((await readFile(join(worktree, "new.txt"), "utf8")).trim(), "hello");
  assert.equal(await git("rev-parse", `sub/${short}~1`), base.sha);
  assert.equal(await git("log", "-1", "--format=%B", `sub/${short}`), "scope: wrote a file\n\nnew.txt: new\n\nChange: feature");
  const register = JSON.parse(await readFile(`/tmp/${session}/register.json`, "utf8"));
  assert.deepEqual([register.agents[0].worktree, register.agents[0].branch, register.agents[0].base], [worktree, `sub/${short}`, base.sha]);
  assert.equal(await client.discard(result.id), `removed worktree ${worktree} and branch sub/${short}`);
  await assert.rejects(stat(worktree), /ENOENT/);
  assert.equal(await git("branch", "--list", `sub/${short}`), "");
  await assert.rejects(client.discard(result.id), /has no worktree/);
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});

test("real supervisor with a fake pi: an agent without changes loses its worktree and branch", { timeout: 30_000 }, async () => {
  const id = randomUUID();
  sessionIds.push(id);
  const { session, socket: path } = await ensure(id, fakePi);
  const client = await connectMain(path, timers);
  const result = await client.start("say hi", ["--no-tools"], [], source);
  assert.equal(result.worktree, undefined);
  assert.equal(await git("branch", "--list", `sub/${result.id.slice(0, 8)}`), "");
  await assert.rejects(stat(join(work, ".worktrees", "proj", `sub-${result.id.slice(0, 8)}`)), /ENOENT/);
  client.close();
  const tmux = createTmux(exec, socket);
  for (let i = 0; i < 100 && (await tmux.hasSession(session)); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await tmux.hasSession(session), false);
});
