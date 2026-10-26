import assert from "node:assert/strict";
import { test } from "node:test";
import { shapeResult } from "./result.ts";

const base = { id: "abc", status: "idle" as const, text: "done", usage: { tokens: 1234, cost: 0.5 }, events: [] };

test("the content has only id, status, text and one usage line", () => {
  const shaped = shapeResult({ ...base, events: ["tool bash {}"] });
  assert.equal(shaped.content.length, 1);
  assert.equal(shaped.content[0]?.text, "agent abc\nstatus: idle\ndone\n1234 tokens, $0.5000");
  assert.doesNotMatch(shaped.content[0]?.text ?? "", /tool bash/);
});

test("details carry handoff and gate", () => {
  const gate = { ok: true as const, files: [], tests: "t" };
  const handoff = {
    subject: "scope: what",
    summary: "s",
    change: "fix" as const,
    changes: [],
    tests: [],
    findings: ["a.ts:1 x"],
    decisions: [],
    open: [],
    next: "",
    risks: [],
  };
  const shaped = shapeResult({ ...base, handoff, gate });
  assert.deepEqual([shaped.details.handoff, shaped.details.gate], [handoff, gate]);
});

test("a result with a worktree shows the short commit and its subject", () => {
  const handoff = {
    subject: "scope: what",
    summary: "s",
    change: "fix" as const,
    changes: [],
    tests: [],
    findings: [],
    decisions: [],
    open: [],
    next: "",
    risks: [],
  };
  const shaped = shapeResult({ ...base, handoff, worktree: "/w", branch: "sub/a", commit: "0123456789abcdef" });
  assert.match(shaped.content[0]?.text ?? "", /worktree: \/w\nbranch: sub\/a\ncommit: 0123456 scope: what\n/);
  assert.equal(shaped.details.commit, "0123456789abcdef");
});

test("details keep at most 20 events of at most 200 characters", () => {
  const events = Array.from({ length: 30 }, (_, i) => `${i}${"y".repeat(300)}`);
  const shaped = shapeResult({ ...base, events });
  assert.equal(shaped.details.events.length, 20);
  assert.ok(shaped.details.events.every((event) => event.length <= 200));
  assert.ok(shaped.details.events[0]?.startsWith("10"));
});

test("question and blocked results have only id, status and text", () => {
  for (const status of ["question", "blocked"] as const) {
    assert.equal(shapeResult({ ...base, status, text: "which db?" }).content[0]?.text, `agent abc\nstatus: ${status}\nwhich db?`);
  }
});

test("a failed result shows its status", () => {
  assert.match(shapeResult({ ...base, status: "failed", text: "boom" }).content[0]?.text ?? "", /status: failed\nboom/);
});
