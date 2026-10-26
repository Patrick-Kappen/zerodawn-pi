import assert from "node:assert/strict";
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

test("a short command returns its result inline", async () => {
  const r = await bash({ command: "echo hi" }, "a");
  assert.match(r.content[0].text, /^exit 0 \(\d+s\)\nhi$/);
  assert.equal(s.jobs.get(r.details.job)?.bg, false);
});

test("a failing command throws its result", async () => {
  await assert.rejects(
    bash({ command: "echo bad >&2; exit 2" }, "b"),
    /^Error: exit 2 \(\d+s\) \u00b7 1 lines.*\nno line looks like an error; last 1 lines:\nbad$/,
  );
});

test("background: true returns the job id at once and a report follows", async () => {
  const r = await bash({ command: "echo late", background: true }, "c");
  assert.match(r.content[0].text, /^job .* runs in the background/);
  assert.equal(r.details.background, true);
  while (reported.length === 0) await new Promise((done) => setTimeout(done, 50));
  assert.equal(reported[0].id, r.details.job);
});

test(`a command that runs longer than ${INLINE_WAIT_S} s moves to the background on its own`, { timeout: (INLINE_WAIT_S + 10) * 1000 }, async () => {
  const start = Date.now();
  const r = await bash({ command: "sleep 60", timeout: INLINE_WAIT_S + 5 }, "d");
  assert.match(r.content[0].text, /^job .* runs in the background/);
  const waited = (Date.now() - start) / 1000;
  assert.ok(waited >= INLINE_WAIT_S && waited < INLINE_WAIT_S + 3, `waited ${waited}s`);
  kill(s.jobs.get(r.details.job)?.pid);
  await new Promise((done) => setTimeout(done, 300));
});
