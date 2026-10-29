import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  BACKGROUND_JOBS_QUERY,
  backgroundJobRunning,
  buildState,
  clipEnd,
  decide,
  FOLLOWUP_TYPE,
  followupText,
  newReasons,
  QUESTIONS,
  REASONS,
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
const handoffWarning = {
  type: "custom_message",
  customType: "handoff-warning",
  content: "System: context 87%; 19k tokens left. Continue working or call handoff for an early handoff.",
  display: true,
};

test("buildState takes the request, the agent message before it, and the answers, but no tool log", () => {
  const entries = [
    msg({ role: "user", content: "old" }),
    msg({ role: "assistant", content: [{ type: "text", text: "Shall I fix the bug in a.ts?" }, call("0", "read", { path: "a.ts" })] }),
    result("0", "read", "ok"),
    msg({ role: "user", content: [{ type: "text", text: "ja" }] }),
    msg({ role: "assistant", content: [call("1", "edit", { path: "a.ts" })] }),
    result("1", "edit", "ok"),
    msg({ role: "assistant", content: [call("2", "run_tests", {})] }),
    result("2", "run_tests", "1 failed", true),
    msg({ role: "assistant", content: [{ type: "text", text: "Half done." }] }),
    followup(["Finish the task."]),
    msg({ role: "assistant", content: [call("4", "bash", { command: "just check" })] }),
    result("4", "bash", "ok"),
    msg({ role: "assistant", content: [{ type: "text", text: "Done." }] }),
  ];
  assert.deepEqual(buildState(entries), {
    previousAnswer: "Shall I fix the bug in a.ts?",
    request: "ja",
    finalAnswer: "Half done.",
    rebuttal: "Done.",
    followupsUsed: 1,
    sentReasons: ["Finish the task."],
    rebutted: false,
  });
});

test("clipEnd keeps the end of a long previous answer, where its question is", () => {
  assert.equal(clipEnd("abcdef", 3), "…def");
  assert.equal(clipEnd("abc", 3), "abc");
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
const settled = { open_point: bool(0.1), in_request: bool(0.1), agent_can_do: bool(0.1), question_answerable: bool(0.1) };
const open = (inRequest: number, agentCanDo: number) => ({ ...settled, open_point: bool(0.9), in_request: bool(inRequest), agent_can_do: bool(agentCanDo) });

test("QUESTIONS tell the classifier that a step for the user and a side finding are not work to do", () => {
  assert.match(QUESTIONS.agent_can_do.instructions, /merge, push, release, rebuild, restart, reboot/);
  assert.match(QUESTIONS.in_request.instructions, /side finding, a defect outside the request, an unrelated failing test/);
  assert.match(QUESTIONS.in_request.instructions, /When request is a question, an answer to the question completes it/);
});

test("decide settles an answer that names no open point", () => {
  assert.deepEqual(decide(settled), []);
});

test("decide sends back an open point only when it is in the request and needs no user", () => {
  assert.deepEqual(decide(open(0.9, 0.9)), [REASONS.open]);
  assert.deepEqual(decide(open(0.2, 0.9)), [], "a side finding outside the request settles");
  assert.deepEqual(decide(open(0.9, 0.2)), [], "a step for the user settles");
});

test("decide settles an answer to a question that also reports a side finding", () => {
  const answered = { ...settled, open_point: bool(0.95), in_request: bool(0.15), agent_can_do: bool(0.9) };
  assert.deepEqual(decide(answered), []);
});

test("decide sends back a question in the request that the agent can answer, not one for the user", () => {
  const inRequest = { ...settled, in_request: bool(0.9) };
  assert.deepEqual(decide({ ...inRequest, question_answerable: bool(0.9) }), [REASONS.question]);
  assert.deepEqual(decide({ ...inRequest, question_answerable: bool(0.2) }), []);
  assert.deepEqual(decide({ ...settled, question_answerable: bool(0.9) }), [], "a question outside the request settles");
});

test("followupText lists each reason", () => {
  assert.equal(followupText(["A.", "B."]), "checker:\n- A.\n- B.\nIf wrong, say why in one sentence.");
});
