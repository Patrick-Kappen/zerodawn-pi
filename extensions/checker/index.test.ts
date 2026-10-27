import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  BACKGROUND_JOBS_QUERY,
  backgroundJobRunning,
  buildState,
  decide,
  FOLLOWUP_TYPE,
  followupText,
  HANDOFF_WARNING_TYPE,
  QUESTIONS,
  shouldCheck,
} from "./index.ts";

test("shouldCheck runs on a completed run that ends on assistant text, not on a continuation or abort", () => {
  assert.equal(shouldCheck({ outcome: "completed", continue: false }), true);
  assert.equal(shouldCheck({ outcome: "completed", continue: true }), false);
  assert.equal(shouldCheck({ outcome: "aborted", continue: false }), false);
});

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
  assert.equal(s.followupsUsed, 0);
});

test("buildState counts follow-ups in a row; a tool call sets the count back to 0", () => {
  const followup = { type: "custom_message", customType: FOLLOWUP_TYPE, content: "x", display: false };
  const answer = msg({ role: "assistant", content: [{ type: "text", text: "later" }] });
  const entries = [msg({ role: "user", content: "go" }), answer, followup, answer, followup, answer];
  assert.equal(buildState(entries)?.followupsUsed, 2);
  entries.push(followup, msg({ role: "assistant", content: [call("1", "read", { path: "a" })] }), result("1", "read", "ok"), answer);
  assert.equal(buildState(entries)?.followupsUsed, 0);
});

test("buildState marks a run with a handoff warning as stop requested", () => {
  const user = { type: "message", message: { role: "user", content: "go" } };
  assert.equal(buildState([user])?.stopRequested, false);
  assert.equal(buildState([user, { type: "custom_message", customType: HANDOFF_WARNING_TYPE, content: "end the run" }])?.stopRequested, true);
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

test("QUESTIONS tell the classifier that a step for the user is not an open point", () => {
  for (const text of [QUESTIONS.status.criteria.incomplete, QUESTIONS.open_error.instructions, QUESTIONS.in_scope.instructions])
    assert.match(text, /step left for the user, such as a merge, rebuild, restart or decision, is not an open point/);
});

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

test("decide sends back an offered step the agent can do, not one that needs a user choice", () => {
  assert.deepEqual(decide({ ...done, next_step_offered: bool(0.9) }), ["Do the step that you offered."]);
  assert.equal(decide({ ...done, next_step_offered: bool(0.3) }).length, 0);
});

test("decide sends back incomplete work", () => {
  assert.equal(decide({ ...done, status: { type: "choice", choice: "incomplete", confidence: 0.8 } }).length, 1);
  assert.equal(decide({ ...done, status: { type: "choice", choice: "incomplete", confidence: 0.5 } }).length, 0);
  assert.equal(decide({ ...done, completeness: { type: "score", score: 1, confidence: 0.6 } }).length, 1);
});

test("followupText lists each reason", () => {
  assert.equal(followupText(["A.", "B."]), "checker:\n- A.\n- B.\nIf wrong, say why in one sentence.");
});
