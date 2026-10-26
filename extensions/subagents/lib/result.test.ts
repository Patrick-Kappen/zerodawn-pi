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

test("details carry done and gate", () => {
  const gate = { ok: true as const, files: [], tests: "t" };
  const done = { summary: "s", findings: ["a.ts:1 x"] };
  const shaped = shapeResult({ ...base, done, gate });
  assert.deepEqual([shaped.details.done, shaped.details.gate], [done, gate]);
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
