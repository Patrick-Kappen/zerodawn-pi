import assert from "node:assert/strict";
import { test } from "node:test";
import { clip, num, summarizeEntries } from "./index.ts";

test("num reads a number from the environment or falls back", () => {
  assert.equal(num("90", 180), 90);
  assert.equal(num("abc", 180), 180);
  assert.equal(num(undefined, 180), 180);
  assert.equal(num("", 0.75), 0.75);
});

test("clip shortens strings and serializes other values", () => {
  assert.equal(clip("abc", 10), "abc");
  assert.equal(clip("abcdef", 3), "abc…");
  assert.equal(clip({ a: 1 }, 100), '{"a":1}');
  assert.equal(clip(undefined, 100), '""');
});

test("summarizeEntries keeps the last entries and condenses message content", () => {
  const entries = [
    { type: "message", timestamp: "t1", message: { role: "user", content: "first" } },
    { type: "compaction", timestamp: "t2" },
    {
      type: "message",
      timestamp: "t3",
      message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "run" }, { type: "toolCall", name: "bash" }, { type: "thinking" }] },
    },
    { type: "message", timestamp: "t4", message: { role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: "x".repeat(400) }] } },
  ];
  const out = summarizeEntries(entries, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { type: "compaction", at: "t2" });
  assert.equal(out[1].text, "run [call bash] [thinking]");
  assert.equal(out[1].stopReason, "toolUse");
  assert.equal(out[2].tool, "bash");
  assert.equal(out[2].isError, true);
  assert.equal(out[2].text.length, 301);
});
