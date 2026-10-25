import { test } from "node:test";
import assert from "node:assert/strict";
import { prunedChars, selectEdits, stub } from "./select.ts";

const big = "x".repeat(2000);
const user = (id: string) => ({ type: "message", id, message: { role: "user", content: [{ type: "text", text: "hi" }] } });
const result = (id: string, text = big, extra: Record<string, unknown> = {}) => ({
  type: "message",
  id,
  message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text }], ...extra },
});

test("prunes big results older than the kept turns", () => {
  const branch = [user("u1"), result("r1"), user("u2"), result("r2"), user("u3"), result("r3")];
  assert.deepEqual(selectEdits(branch).map((e) => e.targetId), ["r1"]);
});

test("skips small results and results that are already edited", () => {
  const branch = [user("u1"), result("r1", "short"), result("r2"), { type: "context_edit", id: "c1", targetId: "r2" }, user("u2"), user("u3")];
  assert.deepEqual(selectEdits(branch), []);
});

test("the stub names the tool, the size, the first line and the log", () => {
  const text = "exit 0 (3s)\n" + big;
  const s = stub("bash", text, { log: "/tmp/x.log" }, false);
  assert.equal(s, `[pruned bash result: 2 lines, ${text.length} chars. First line: exit 0 (3s). Full output: /tmp/x.log]`);
  assert.match(stub("read", big, {}, true), /^\[pruned read error: 1 lines, 2000 chars\. First line: x+\. Run the tool again when you need it\.\]$/);
});

test("prunedChars counts the saved characters", () => {
  const branch = [user("u1"), result("r1"), user("u2"), user("u3")];
  const edits = selectEdits(branch);
  assert.equal(prunedChars(branch, edits), 2000 - edits[0].replacement.content.length);
});
