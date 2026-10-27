import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createState } from "../state.ts";
import type { Job } from "./jobproc.ts";
import { registerJobs } from "./jobs.ts";

const handlers = new Map<string, (event: any, ctx?: any) => unknown>();
const pi = {
  on: (name: string, fn: (event: any, ctx?: any) => unknown) => handlers.set(name, fn),
  registerTool() {},
  registerShortcut() {},
  registerCommand() {},
  sendMessage() {},
} as any;
const s = createState();
registerJobs(pi, s, { refresh() {}, stop() {} });
handlers.get("session_shutdown")?.({ reason: "quit" });
const job = (id: string, extra: Partial<Job>): Job => ({
  id,
  command: "x",
  log: "",
  meta: "",
  start: Number(id),
  bg: true,
  stats: () => ({ lines: 0, bytes: 0 }),
  ...extra,
});
const start = () => handlers.get("before_agent_start")?.({ messageType: "user" }) as { message?: { content: string } } | undefined;

test("a prompt gets a status note only when a background job changed", () => {
  assert.equal(start(), undefined);
  s.jobs.set("1", job("1", {}));
  s.jobs.set("2", job("2", { group: "g" }));
  assert.equal(start()?.message?.content, "jobs: 1: running · 2 [g]: running");
  assert.equal(start(), undefined);
  s.jobs.set("1", job("1", { result: "exit 1 (3s) · 2 lines" }));
  assert.equal(start()?.message?.content, "jobs: 1: exit 1 (3s) · 2 [g]: running");
  assert.equal(handlers.get("before_agent_start")?.({ messageType: "custom" }), undefined);
  handlers.get("message_end")?.({ message: { role: "custom", customType: "bash-job", details: { jobs: "1" } } });
  assert.equal(start(), undefined);
  s.jobs.set("2", job("2", { group: "g", result: "exit 0 (1s)" }));
  assert.equal(start()?.message?.content, "jobs: 2 [g]: exit 0 (1s)");
});

test("jobs list gives the model only running jobs; an ended job is reported once by its message", async () => {
  const tools: any[] = [];
  const own = createState();
  registerJobs({ ...pi, on() {}, registerTool: (t: any) => tools.push(t) }, own, { refresh() {}, stop() {} });
  const list = async () => (await tools[0].execute("id", { action: "list" })).content[0].text as string;
  assert.equal(await list(), "No running bash jobs. A message reports each result once.");
  own.jobs.set("1", job("1", { result: "exit 0 (1s)", endedAt: 1 }));
  own.jobs.set("2", job("2", { bg: false, result: "exit 0 (1s)", endedAt: 2 }));
  own.jobs.set("3", job("3", { command: "sleep 9" }));
  assert.match(await list(), /^job 3 · [^\n]*sleep 9[^\n]*$/);
  await assert.rejects(list(), /no change since the last jobs call/);
  own.jobs.set("4", job("4", { command: "sleep 8" }));
  assert.match(await list(), /^job 4 · [^\n]*sleep 8[^\n]*\njob 3 · /);
});

test("print mode: before settle waits for a running background job and sends its report", async () => {
  const own = new Map<string, (event: any, ctx?: any) => unknown>();
  const sent: string[] = [];
  const api = {
    on: (name: string, fn: (event: any, ctx?: any) => unknown) => own.set(name, fn),
    registerTool() {},
    registerShortcut() {},
    registerCommand() {},
    sendMessage: (message: { content: string }) => sent.push(message.content),
  } as any;
  const state = createState();
  const reports = registerJobs(api, state, { refresh() {}, stop() {} });
  const settle = own.get("agent_before_settle") as (event: unknown, ctx: unknown) => Promise<unknown>;
  assert.equal(await settle({}, { mode: "tui" }), undefined);
  assert.equal(await settle({}, { mode: "print" }), undefined, "no running job: nothing to wait for");
  own.get("agent_start")?.({});
  const running = job("7", {});
  state.jobs.set("7", running);
  const waiting = settle({}, { mode: "print" });
  reports.report(running, {} as any, "exit 0 (20s)", true);
  assert.deepEqual(await waiting, { continue: true });
  assert.deepEqual(sent, ["job 7: exit 0 (20s)"]);
  own.get("session_shutdown")?.({ reason: "quit" });
});

test("after a restart, a background job that was reported does not come back in the status note", () => {
  const root = mkdtempSync(join(tmpdir(), "jobs-restart-"));
  const jobsDir = join(root, "s", "jobs");
  mkdirSync(jobsDir, { recursive: true });
  const meta = (id: string, reported: boolean) =>
    writeFileSync(
      join(jobsDir, `${id}.json`),
      JSON.stringify({ id, command: "x", log: join(root, `${id}.log`), status: join(root, `${id}.status`), pid: 1, start: 1, limit: 0, bg: true, reported }),
    );
  meta("7.1-C1", true);
  writeFileSync(join(root, "7.1-C1.status"), "0\n");
  meta("7.2-C1", false);
  writeFileSync(join(root, "7.2-C1.status"), "0\n");
  const own = new Map<string, (event: any, ctx?: any) => unknown>();
  registerJobs({ ...pi, on: (name: string, fn: any) => own.set(name, fn) }, createState(), { refresh() {}, stop() {} });
  const ctx = { ui: { notify() {} }, isIdle: () => true, sessionManager: { getSessionFile: () => join(root, "s.jsonl"), getBranch: () => [] } };
  own.get("session_start")?.({}, ctx);
  const note = own.get("before_agent_start")?.({ messageType: "user" }) as { message?: { content: string } } | undefined;
  assert.doesNotMatch(note?.message?.content ?? "", /7\.1-C1/);
  own.get("session_shutdown")?.({ reason: "reload" });
  rmSync(root, { recursive: true, force: true });
});
