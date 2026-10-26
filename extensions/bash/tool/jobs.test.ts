import assert from "node:assert/strict";
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
