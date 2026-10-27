import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { BACKGROUND_JOBS_QUERY, backgroundJobRunning, buildState, decide, FOLLOWUP_TYPE, followupText } from "./index.ts";

test("backgroundJobRunning asks the bash extension and is false without an answer", () => {
  const events = createEventBus();
  assert.equal(backgroundJobRunning({ events }), false);
  events.on(BACKGROUND_JOBS_QUERY, (q) => {
    (q as { running: boolean }).running = true;
  });
  assert.equal(backgroundJobRunning({ events }), true);
});

const msg = (message: any) => ({ type: "message", message });
const call = (id: string, name: string, args: any) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, toolName: string, t: string, isError = false) =>
  msg({ role: "toolResult", toolCallId: id, toolName, isError, content: [{ type: "text", text: t }] });

test("buildState takes only the run since the last user message", () => {
  const entries = [
    msg({ role: "user", content: "old" }),
    msg({ role: "assistant", content: [{ type: "text", text: "old answer" }] }),
    msg({ role: "user", content: [{ type: "text", text: "fix the bug" }] }),
    msg({ role: "assistant", content: [call("1", "edit", { path: "a.ts" })] }),
    result("1", "edit", "ok"),
    msg({ role: "assistant", content: [call("2", "run_tests", {})] }),
    result("2", "run_tests", "1 failed", true),
    msg({ role: "assistant", content: [call("3", "write", { path: "b.ts" })] }),
    result("3", "write", "ok"),
    { type: "custom_message", customType: FOLLOWUP_TYPE, content: "x", display: false },
    msg({ role: "assistant", content: [call("4", "bash", { command: "just check" })] }),
    result("4", "bash", "ok"),
    msg({ role: "assistant", content: [{ type: "text", text: "Done." }] }),
  ];
  const s = buildState(entries);
  assert.ok(s);
  assert.equal(s.request, "fix the bug");
  assert.equal(s.finalAnswer, "Done.");
  assert.deepEqual(s.edits, ["a.ts", "b.ts"]);
  assert.deepEqual(s.toolErrors, [{ tool: "run_tests", text: "1 failed" }]);
  assert.deepEqual(s.toolsUsed, { edit: 1, run_tests: 1, write: 1, bash: 1 });
  assert.equal(s.followupsUsed, 1);
});

test("buildState returns undefined without a user message", () => {
  assert.equal(buildState([msg({ role: "assistant", content: "hi" })]), undefined);
});

const bool = (probability: number) => ({ type: "bool", probability });
const done = {
  status: { type: "choice", choice: "done", confidence: 0.9 },
  open_error: bool(0.1),
  in_scope: bool(0.1),
  question_answerable: bool(0.1),
  completeness: { type: "score", score: 3, confidence: 0.9 },
  rule_violation: bool(0.9),
};

test("decide settles a finished run, also with a rule violation", () => {
  assert.deepEqual(decide(done), []);
});

test("decide sends back an open error in scope only", () => {
  assert.equal(decide({ ...done, open_error: bool(0.9), in_scope: bool(0.9) }).length, 1);
  assert.equal(decide({ ...done, open_error: bool(0.9), in_scope: bool(0.3) }).length, 0);
});

test("decide sends back a question the agent can answer, not one for the user", () => {
  const q = { ...done, status: { type: "choice", choice: "question", confidence: 0.9 } };
  assert.equal(decide({ ...q, question_answerable: bool(0.9) }).length, 1);
  assert.equal(decide({ ...q, question_answerable: bool(0.2) }).length, 0);
});

test("decide sends back incomplete work", () => {
  assert.equal(decide({ ...done, status: { type: "choice", choice: "incomplete", confidence: 0.8 } }).length, 1);
  assert.equal(decide({ ...done, status: { type: "choice", choice: "incomplete", confidence: 0.5 } }).length, 0);
  assert.equal(decide({ ...done, completeness: { type: "score", score: 1, confidence: 0.6 } }).length, 1);
});

test("followupText lists each reason", () => {
  assert.equal(followupText(["A.", "B."]), "checker:\n- A.\n- B.\nIf wrong, say why in one sentence.");
});
