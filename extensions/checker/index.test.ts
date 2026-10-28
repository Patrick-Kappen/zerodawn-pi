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
  newReasons,
  QUESTIONS,
  shouldCheck,
  shouldSkip,
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
const followup = (reasons: string[]) => ({ type: "custom_message", customType: FOLLOWUP_TYPE, content: followupText(reasons), display: false });
const handoffWarning = { type: "custom_message", customType: "handoff-warning", content: "the cut comes after the next tool call", display: true };

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
    msg({ role: "assistant", content: [{ type: "text", text: "Half done." }] }),
    followup(["Finish the task."]),
    msg({ role: "assistant", content: [call("4", "bash", { command: "just check" })] }),
    result("4", "bash", "ok"),
    msg({ role: "assistant", content: [{ type: "text", text: "Done." }] }),
  ];
  const s = buildState(entries);
  assert.ok(s);
  assert.equal(s.request, "fix the bug");
  assert.equal(s.finalAnswer, "Half done.");
  assert.equal(s.rebuttal, "Done.");
  assert.deepEqual(s.edits, ["a.ts", "b.ts"]);
  assert.deepEqual(s.toolErrors, [{ tool: "run_tests", text: "1 failed" }]);
  assert.deepEqual(s.toolsUsed, { edit: 1, run_tests: 1, write: 1, bash: 1 });
  assert.equal(s.followupsUsed, 1);
  assert.deepEqual(s.sentReasons, ["Finish the task."]);
  assert.equal(s.rebutted, false);
});

test("buildState takes finalAnswer from before the first follow-up and the rebuttal after the last", () => {
  const entries = [
    msg({ role: "user", content: "go" }),
    msg({ role: "assistant", content: [{ type: "text", text: "first answer" }] }),
    followup(["Finish the task."]),
    msg({ role: "assistant", content: [{ type: "text", text: "first rebuttal" }] }),
    followup(["Do the step that you offered."]),
    msg({ role: "assistant", content: [{ type: "text", text: "last rebuttal" }] }),
  ];
  const s = buildState(entries);
  assert.ok(s);
  assert.equal(s.finalAnswer, "first answer");
  assert.equal(s.rebuttal, "last rebuttal");
  assert.deepEqual(s.sentReasons, ["Finish the task.", "Do the step that you offered."]);
});

test("buildState marks a text-only answer after a follow-up as a rebuttal", () => {
  const answer = msg({ role: "assistant", content: [{ type: "text", text: "later" }] });
  const entries = [msg({ role: "user", content: "go" }), answer, followup(["Finish the task."]), answer];
  assert.equal(buildState(entries)?.rebutted, true);
  assert.equal(buildState([msg({ role: "user", content: "go" }), answer])?.rebutted, false);
  entries.push(msg({ role: "assistant", content: [call("1", "read", { path: "a" })] }), result("1", "read", "ok"));
  assert.equal(buildState(entries)?.rebutted, false);
});

test("newReasons drops every reason an earlier follow-up already sent", () => {
  assert.deepEqual(newReasons(["Finish the task.", "Fix the error in scope."], ["Finish the task."]), ["Fix the error in scope."]);
  assert.deepEqual(newReasons(["Finish the task."], ["Finish the task."]), []);
});

test("buildState counts all follow-ups since the last user message; a tool call does not reset the count", () => {
  const answer = msg({ role: "assistant", content: [{ type: "text", text: "later" }] });
  const entries = [msg({ role: "user", content: "go" }), answer, followup(["Finish the task."]), answer, followup(["Finish the task."]), answer];
  assert.equal(buildState(entries)?.followupsUsed, 2);
  entries.push(msg({ role: "assistant", content: [call("1", "read", { path: "a" })] }), result("1", "read", "ok"));
  assert.equal(buildState(entries)?.followupsUsed, 2);
  entries.push(followup(["Finish the task."]), answer);
  assert.equal(buildState(entries)?.followupsUsed, 3);
});

test("a final answer after a handoff warning is checked", () => {
  const answer = msg({ role: "assistant", content: [{ type: "text", text: "later" }] });
  const s = buildState([msg({ role: "user", content: "go" }), answer, handoffWarning]);
  assert.ok(s);
  assert.equal(shouldSkip(s), false);
});

test("a live branch with three rounds of follow-up and text-only rebuttal gives at most one follow-up", () => {
  const entries: any[] = [msg({ role: "user", content: "fix the bug" }), msg({ role: "assistant", content: [{ type: "text", text: "I fixed it." }] })];
  let given = 0;
  for (let round = 0; round < 3; round++) {
    const state = buildState(entries);
    assert.ok(state);
    if (shouldSkip(state)) break;
    const reasons = newReasons(["Finish the task."], state.sentReasons);
    if (reasons.length === 0 || state.followupsUsed >= 3) break;
    given++;
    entries.push(followup(reasons));
    entries.push(msg({ role: "assistant", content: [{ type: "text", text: "the checker is wrong: it is done" }] }));
  }
  assert.equal(given, 1);
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

test("decide sends back a check that the agent left open", () => {
  assert.deepEqual(decide({ ...done, unchecked: bool(0.9) }), ["Do the check that you left open."]);
  assert.equal(decide({ ...done, unchecked: bool(0.3) }).length, 0);
});

test("decide sends back incomplete work", () => {
  assert.equal(decide({ ...done, status: { type: "choice", choice: "incomplete", confidence: 0.8 } }).length, 1);
  assert.equal(decide({ ...done, status: { type: "choice", choice: "incomplete", confidence: 0.5 } }).length, 0);
  assert.equal(decide({ ...done, completeness: { type: "score", score: 1, confidence: 0.6 } }).length, 1);
});

test("followupText lists each reason", () => {
  assert.equal(followupText(["A.", "B."]), "checker:\n- A.\n- B.\nIf wrong, say why in one sentence.");
});
