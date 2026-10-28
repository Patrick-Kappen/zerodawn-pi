import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { INLINE_WAIT_S } from "../config.ts";
import { createState } from "../state.ts";
import { registerBash } from "./bash.ts";
import { type Job, kill } from "./jobproc.ts";

const dir = mkdtempSync(join(tmpdir(), "bash-tool-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const s = createState();
const reported: Job[] = [];
const tools: any[] = [];
registerBash(
  { registerTool: (t: any) => tools.push(t) } as any,
  s,
  { refresh() {}, stop() {} },
  {
    report: (job) => reported.push(job),
    releaseGroup() {},
  },
);
const ctx = {
  cwd: dir,
  sessionManager: { getSessionFile: () => join(dir, "session.jsonl"), getBranch: () => [] },
  ui: { setStatus() {}, theme: { fg: (_c: string, t: string) => t } },
};
const bash = (params: Record<string, unknown>, id: string) => tools[0].execute(id, params, undefined, undefined, ctx);

test("a quick command returns its result inline", async () => {
  const r = await bash({ command: "echo hi" }, "a");
  assert.match(r.content[0].text, /^exit 0 \(\d+s\)\nhi$/);
  assert.equal(s.jobs.get(r.details.job)?.bg, false);
});

test("a failing command throws its result", async () => {
  await assert.rejects(bash({ command: "echo bad >&2; false" }, "b"), /^Error: exit 1 \(\d+s\)\nbad$/);
});

test("a missing working directory fails with its path before the command starts", async () => {
  const gone = join(dir, "gone");
  await assert.rejects(
    tools[0].execute("c", { command: "true" }, undefined, undefined, { ...ctx, cwd: gone }),
    new RegExp(`working directory ${gone} does not exist`),
  );
});

test("a command that is not quick returns the job id at once, keeps the turn, and a report follows", async () => {
  const start = Date.now();
  const r = await bash({ command: "sleep 0.3; echo late" }, "c");
  assert.ok(Date.now() - start < 250, "the tool does not wait for the command");
  assert.match(r.content[0].text, /^job .*: running · log: /);
  assert.equal(r.details.background, true);
  assert.equal(r.terminate, undefined, "the agent goes on with other work");
  while (reported.length === 0) await new Promise((done) => setTimeout(done, 50));
  assert.equal(reported[0].id, r.details.job);
});

test("a command that is the only tool call of its message returns its result inline", async () => {
  const call = { type: "toolCall", id: "e", name: "bash", arguments: { command: "sleep 0.3; echo late" } };
  const branch = [{ type: "message", message: { role: "assistant", content: [call] } }];
  const r = await tools[0].execute("e", call.arguments, undefined, undefined, {
    ...ctx,
    sessionManager: { ...ctx.sessionManager, getBranch: () => branch },
  });
  assert.match(r.content[0].text, /^exit 0 \(\d+s\)\nlate$/);
  assert.equal(s.jobs.get(r.details.job)?.bg, false);
});

test("background starts a command alone in its message as a job at once", async () => {
  const call = { type: "toolCall", id: "f", name: "bash", arguments: { command: "sleep 0.3; echo late", background: true } };
  const branch = [{ type: "message", message: { role: "assistant", content: [call] } }];
  const start = Date.now();
  const r = await tools[0].execute("f", call.arguments, undefined, undefined, {
    ...ctx,
    sessionManager: { ...ctx.sessionManager, getBranch: () => branch },
  });
  assert.ok(Date.now() - start < 250, "the tool does not wait for the command");
  assert.equal(r.details.background, true);
  while (!reported.some((j) => j.id === r.details.job)) await new Promise((done) => setTimeout(done, 50));
});

test(`a quick command that runs longer than ${INLINE_WAIT_S} s moves to the background and keeps the turn`, {
  timeout: (INLINE_WAIT_S + 10) * 1000,
}, async () => {
  const fifo = join(dir, "fifo");
  execFileSync("mkfifo", [fifo]);
  const start = Date.now();
  const r = await bash({ command: `cat ${fifo}`, timeout: INLINE_WAIT_S + 5 }, "d");
  assert.match(r.content[0].text, /^job .*: running · log: /);
  assert.equal(r.terminate, undefined);
  const waited = (Date.now() - start) / 1000;
  assert.ok(waited >= INLINE_WAIT_S && waited < INLINE_WAIT_S + 3, `waited ${waited}s`);
  kill(s.jobs.get(r.details.job)?.pid);
  await new Promise((done) => setTimeout(done, 300));
});
