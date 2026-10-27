import assert from "node:assert/strict";
import { test } from "node:test";
import type { GateResult } from "./gate.ts";
import type { CommitSpec } from "./git.ts";
import type { ClientMessage } from "./protocol.ts";
import { CHOICE_PROMPT, createSubHandlers, GATE_HANDOFF_PROMPT, GREEN_HANDOFF_PROMPT, HANDOFF_PROMPT, readSubEnv, shorten } from "./sub.ts";

const GREEN: GateResult = { ok: true, reason: "tests and checks green", files: ["a.ts", "a.test.ts"], tests: "green: 3 pass, 0 fail" };
const SCOUT_GREEN: GateResult = { ok: true, reason: "no changed files", files: [], tests: "not run: no changed files" };
const HANDOFF = {
  subject: "scope: what",
  summary: "It works.",
  change: "fix" as const,
  changes: [
    { file: "a.ts", what: "w" },
    { file: "a.test.ts", what: "t" },
  ],
  tests: [{ file: "a.test.ts", covers: "c" }],
  findings: [],
  decisions: [],
  open: [],
  next: "",
  risks: [],
};
const FINDINGS = { ...HANDOFF, changes: [], tests: [], findings: ["a.ts:1 x"] };
const ANTHROPIC = { tools: [{ name: "done", input_schema: {} }] };

function setup(result: GateResult | Error = GREEN, idle = false, changed = ["a.ts", "a.test.ts"]) {
  const sent: ClientMessage[] = [];
  const user: string[] = [];
  let gates = 0;
  const calls: string[] = [];
  const commits: CommitSpec[] = [];
  const refusals: string[] = [];
  const handlers = createSubHandlers({
    send: (message) => sent.push(message),
    sendUserMessage: (text) => user.push(text),
    abort: () => calls.push("abort"),
    isIdle: () => idle,
    getActiveTools: () => ["read", "ask"],
    setActiveTools: (names) => calls.push(`tools ${names.join(",")}`),
    changed: () => changed,
    commit: async (spec) => {
      const refusal = refusals.shift();
      if (refusal !== undefined) throw new Error(refusal);
      commits.push(spec);
      return "abc123";
    },
    gate: async (send) => {
      gates++;
      if (result instanceof Error) throw result;
      if (!result.ok) send("fix it");
      return result;
    },
  });
  return { sent, user, handlers, gates: () => gates, calls, commits, refusals };
}

const usage = { totalTokens: 10, cost: { total: 0.02 } };

test("readSubEnv: none set is a main pi, both set is a subagent, one set fails", () => {
  assert.equal(readSubEnv({}), undefined);
  assert.deepEqual(readSubEnv({ PI_SUBAGENT_SOCKET: "/s", PI_SUBAGENT_ID: "i", PI_SUBAGENT_CHECKS: '["just lint"]' }), {
    socket: "/s",
    id: "i",
    checks: ["just lint"],
  });
  assert.throws(() => readSubEnv({ PI_SUBAGENT_SOCKET: "/s", PI_SUBAGENT_ID: "i" }), /PI_SUBAGENT_CHECKS is not set/);
  assert.throws(() => readSubEnv({ PI_SUBAGENT_SOCKET: "/s", PI_SUBAGENT_ID: "i", PI_SUBAGENT_CHECKS: "x" }), /not valid JSON/);
  assert.throws(() => readSubEnv({ PI_SUBAGENT_SOCKET: "/s", PI_SUBAGENT_ID: "i", PI_SUBAGENT_CHECKS: "[1]" }), /not a list of strings/);
  assert.throws(() => readSubEnv({ PI_SUBAGENT_SOCKET: "/s" }), /both PI_SUBAGENT_SOCKET and PI_SUBAGENT_ID/);
  assert.throws(() => readSubEnv({ PI_SUBAGENT_ID: "i" }), /both/);
  assert.throws(() => readSubEnv({ PI_SUBAGENT_SOCKET: "", PI_SUBAGENT_ID: "i" }), /both/);
});

test("a task message becomes a user message; other messages fail loud", () => {
  const { user, handlers } = setup();
  handlers.onServerMessage({ type: "task", task: "do it" });
  assert.deepEqual(user, ["do it"]);
  assert.throws(() => handlers.onServerMessage({ type: "error", message: "bad" }), /refused the request: bad/);
  assert.throws(() => handlers.onServerMessage({ type: "started", requestId: "1", id: "a" }), /sent "started"/);
});

test("tool events carry the name and arguments shortened to 200 characters", () => {
  const { sent, handlers } = setup();
  handlers.toolStart({ toolName: "bash", args: { command: "x".repeat(500) } });
  handlers.toolEnd({ toolName: "bash", isError: true });
  const start = sent[0];
  assert.ok(start?.type === "event" && start.event.kind === "tool_start");
  assert.equal(start.event.args.length, 200);
  assert.deepEqual(sent[1], { type: "event", event: { kind: "tool_end", name: "bash", isError: true } });
});

test("assistant messages send shortened text and usage; other roles are ignored", () => {
  const { sent, handlers } = setup();
  handlers.messageEnd({ role: "user", content: "hi" });
  handlers.messageEnd({ role: "assistant", content: [{ type: "thinking" }, { type: "text", text: "a".repeat(300) }], usage });
  assert.equal(sent.length, 1);
  const event = sent[0];
  assert.ok(event?.type === "event" && event.event.kind === "message");
  assert.equal(event.event.text.length, 200);
  assert.deepEqual(event.event.usage, { tokens: 10, cost: 0.02 });
  assert.throws(() => handlers.messageEnd({ role: "assistant", content: [] }), /no usage/);
});

async function stopAndDone(handlers: ReturnType<typeof setup>["handlers"]) {
  await handlers.settled();
  handlers.done();
  await handlers.settled();
}

test("a settle without done, ask or blocker forces a choice between continue, done, ask and blocker", async () => {
  const { sent, user, calls, handlers, gates } = setup();
  await handlers.settled();
  assert.deepEqual(user, [CHOICE_PROMPT]);
  assert.deepEqual(calls, ["tools continue,done,ask,blocker"]);
  assert.equal(gates(), 0);
  assert.deepEqual(sent, []);
  assert.deepEqual(handlers.beforeRequest(ANTHROPIC), { ...ANTHROPIC, tool_choice: { type: "any" } });
});

test("continue restores the tools, stops the forcing and returns the text; the next settle asks again", async () => {
  const { user, calls, handlers } = setup();
  await handlers.settled();
  assert.equal(handlers.continue(), "Continue with the task.");
  assert.deepEqual(calls, ["tools continue,done,ask,blocker", "tools read,ask"]);
  assert.equal(handlers.beforeRequest(ANTHROPIC), undefined);
  await handlers.settled();
  await handlers.settled();
  assert.deepEqual(user, [CHOICE_PROMPT, CHOICE_PROMPT]);
});

test("continue outside a choice fails", () => {
  assert.throws(() => setup().handlers.continue(), /not active/);
});

test("settled while the choice is forced and no tool call came is an error event", async () => {
  const { handlers, sent } = setup();
  await handlers.settled();
  await handlers.settled();
  const error = sent.at(-1);
  assert.ok(error?.type === "event" && error.event.kind === "error");
  assert.match(error.event.text, /without a call of continue, done, ask or blocker/);
});

test("done in the choice restores the tools and the next settle runs the gate; the green gate forces the handoff", async () => {
  const { sent, user, calls, handlers, gates } = setup();
  await handlers.settled();
  assert.match(handlers.done(), /checks run now/);
  assert.equal(handlers.beforeRequest(ANTHROPIC), undefined);
  await handlers.settled();
  assert.equal(gates(), 1);
  assert.deepEqual(sent, [{ type: "event", event: { kind: "gate", ok: true, text: "tests and checks green" } }]);
  assert.deepEqual(user, [CHOICE_PROMPT, GREEN_HANDOFF_PROMPT]);
  assert.deepEqual(calls, ["tools continue,done,ask,blocker", "tools read,ask", "tools handoff"]);
  const tools = { tools: [{ name: "handoff", input_schema: {} }] };
  assert.deepEqual(handlers.beforeRequest(tools), { ...tools, tool_choice: { type: "tool", name: "handoff" } });
});

test("done without a prior stop (the model chose it) runs the gate at the settle", async () => {
  const { handlers, gates, user } = setup();
  handlers.done();
  await handlers.settled();
  assert.equal(gates(), 1);
  assert.deepEqual(user, [GREEN_HANDOFF_PROMPT]);
});

test("a valid handoff after a green gate sends the gate data and nothing more goes to the agent", async () => {
  const { sent, user, calls, handlers } = setup();
  await stopAndDone(handlers);
  sent.length = 0;
  assert.match(await handlers.handoff(HANDOFF), /Handoff sent/);
  assert.deepEqual(sent, [
    { type: "handoff", data: HANDOFF, gate: { ok: true, files: ["a.ts", "a.test.ts"], tests: "green: 3 pass, 0 fail" }, commit: "abc123" },
  ]);
  const users = user.length;
  const toolCalls = calls.length;
  await handlers.settled();
  assert.equal(user.length, users);
  assert.equal(calls.length, toolCalls);
  assert.equal(sent.length, 1);
  assert.equal(handlers.beforeRequest({ tools: [{ name: "handoff", input_schema: {} }] }), undefined);
});

test("a new task after the handoff restores the tools and resets the gate data", async () => {
  const { sent, user, calls, handlers, gates } = setup();
  await stopAndDone(handlers);
  await handlers.handoff(HANDOFF);
  handlers.onServerMessage({ type: "task", task: "more" });
  assert.deepEqual(calls.slice(-1), ["tools read,ask"]);
  assert.equal(user.at(-1), "more");
  await stopAndDone(handlers);
  assert.equal(gates(), 2);
  assert.equal(user.at(-1), GREEN_HANDOFF_PROMPT);
  sent.length = 0;
  await handlers.handoff(HANDOFF);
  assert.ok(sent[0]?.type === "handoff" && sent[0].gate !== undefined);
});

test("no changed files and nothing to test: green, and the handoff needs findings", async () => {
  const { sent, handlers } = setup(SCOUT_GREEN, false, []);
  await stopAndDone(handlers);
  await assert.rejects(() => handlers.handoff({ ...FINDINGS, findings: [] }), /needs at least one entry/);
  assert.match(await handlers.handoff(FINDINGS), /Handoff sent/);
  assert.deepEqual(sent.at(-1), { type: "handoff", data: FINDINGS, gate: { ok: true, files: [], tests: "not run: no changed files" } });
});

test("handoff checks changes against git: a missing file, an extra file, and an exact match", async () => {
  const missing = setup(GREEN, false, ["a.ts", "a.test.ts", "b.ts"]);
  await stopAndDone(missing.handlers);
  await assert.rejects(
    () => missing.handlers.handoff(HANDOFF),
    /Changed: a\.ts, a\.test\.ts, b\.ts\. Listed: a\.ts, a\.test\.ts\. Not changed: none\. Missing: b\.ts\./,
  );
  const extra = setup(GREEN, false, ["a.ts"]);
  await stopAndDone(extra.handlers);
  await assert.rejects(() => extra.handlers.handoff(HANDOFF), /Not changed: a\.test\.ts\. Missing: none\./);
  assert.ok(!extra.sent.some((message) => message.type === "handoff"));
  const none = setup(GREEN, false, []);
  await stopAndDone(none.handlers);
  await assert.rejects(() => none.handlers.handoff(HANDOFF), /Changed: none\./);
  const ok = setup(GREEN, false, ["a.test.ts", "a.ts"]);
  await stopAndDone(ok.handlers);
  assert.match(await ok.handlers.handoff(HANDOFF), /Handoff sent/);
});

test("settled with a red gate sends the gate event and the failures; the agent keeps running", async () => {
  const { sent, user, handlers } = setup({ ok: false, reason: "the repository tests are red" });
  handlers.messageEnd({ role: "assistant", content: [{ type: "text", text: "done" }], usage });
  sent.length = 0;
  await stopAndDone(handlers);
  assert.deepEqual(sent, [{ type: "event", event: { kind: "gate", ok: false, text: "the repository tests are red" } }]);
  assert.deepEqual(user, [CHOICE_PROMPT, "fix it"]);
});

test("settled skips the choice and the gate after ask or blocker, once", async () => {
  const { sent, user, handlers, gates } = setup();
  handlers.ask("which db?");
  await handlers.settled();
  assert.equal(gates(), 0);
  assert.deepEqual(sent.at(-1), { type: "event", event: { kind: "settled", text: "" } });
  handlers.blocker({ issue: "no access", files: [], tried: ["x"] });
  await handlers.settled();
  assert.deepEqual(user, []);
  await handlers.settled();
  assert.deepEqual(user, [CHOICE_PROMPT]);
});

test("ask and blocker in the choice restore the tools and stop the forcing", async () => {
  const { calls, handlers } = setup();
  await handlers.settled();
  handlers.ask("which db?");
  assert.deepEqual(calls, ["tools continue,done,ask,blocker", "tools read,ask"]);
  assert.equal(handlers.beforeRequest(ANTHROPIC), undefined);
  await handlers.settled();
  const again = setup();
  await again.handlers.settled();
  again.handlers.blocker({ issue: "i", files: [], tried: ["x"] });
  assert.equal(again.handlers.beforeRequest(ANTHROPIC), undefined);
});

test("ask and blocker send their text and tell the model to stop", () => {
  const { sent, handlers } = setup();
  assert.match(handlers.ask("which db?"), /Stop now and wait/);
  const blocker = { issue: "no access", files: ["a"], tried: ["x"] };
  assert.match(handlers.blocker(blocker), /Stop now and wait/);
  assert.deepEqual(sent, [
    { type: "ask", text: "which db?" },
    { type: "blocker", data: blocker },
  ]);
});

test("the third red gate starts a forced handoff with the gate reason", async () => {
  const { sent, user, calls, handlers } = setup({ ok: false, reason: "the repository tests are red" });
  await stopAndDone(handlers);
  await stopAndDone(handlers);
  assert.equal(user.filter((text) => text === "fix it").length, 2);
  sent.length = 0;
  await stopAndDone(handlers);
  assert.equal(user.at(-1), GATE_HANDOFF_PROMPT);
  assert.equal(calls.at(-1), "tools handoff");
  assert.deepEqual(sent, [{ type: "event", event: { kind: "gate", ok: false, text: "the repository tests are red" } }]);
  assert.match(await handlers.handoff(HANDOFF), /Handoff sent/);
  assert.deepEqual(sent.at(-1), { type: "handoff", data: HANDOFF, reason: "the repository tests are red", commit: "abc123" });
  sent.length = 0;
  await handlers.settled();
  assert.deepEqual(sent, []);
});

test("a new task resets the red gate count", async () => {
  const { user, sent, handlers } = setup({ ok: false, reason: "red" });
  await stopAndDone(handlers);
  await stopAndDone(handlers);
  handlers.onServerMessage({ type: "task", task: "again" });
  await stopAndDone(handlers);
  await stopAndDone(handlers);
  assert.equal(user.filter((text) => text === "fix it").length, 4);
  assert.ok(!user.includes(GATE_HANDOFF_PROMPT));
  assert.ok(!sent.some((message) => message.type === "event" && message.event.kind === "error"));
});

test("a handoff message aborts, sets only the tool handoff and sends the prompt at the next settle", async () => {
  const { handlers, gates, calls, user, sent } = setup(GREEN, false, []);
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(calls, ["abort", "tools handoff"]);
  assert.deepEqual(user, []);
  await handlers.settled();
  assert.deepEqual(user, [HANDOFF_PROMPT]);
  assert.equal(gates(), 0);
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(calls, ["abort", "tools handoff"]);
  assert.match(await handlers.handoff(FINDINGS), /Handoff sent\. Stop\./);
  assert.deepEqual(sent, [{ type: "handoff", data: FINDINGS }]);
  await handlers.settled();
  assert.equal(gates(), 0);
  assert.equal(sent.length, 1);
});

test("a handoff message during the choice goes on and keeps the saved tools", async () => {
  const { handlers, calls, user } = setup(undefined, true);
  await handlers.settled();
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(user, [CHOICE_PROMPT, HANDOFF_PROMPT]);
  handlers.onServerMessage({ type: "task", task: "x" });
  assert.equal(calls.at(-1), "tools read,ask");
});

test("a handoff message on an idle agent sends the prompt at once", () => {
  const { handlers, user } = setup(undefined, true);
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(user, [HANDOFF_PROMPT]);
});

test("the tool handoff fails before a handoff is asked for", async () => {
  const { handlers } = setup();
  await assert.rejects(() => handlers.handoff(HANDOFF), /not active/);
});

test("done fails while a handoff is forced", () => {
  const { handlers } = setup(undefined, true);
  handlers.onServerMessage({ type: "handoff" });
  assert.throws(() => handlers.done(), /not active/);
});

test("two invalid handoff calls send an error event", () => {
  const { handlers, sent } = setup(undefined, true);
  handlers.onServerMessage({ type: "handoff" });
  handlers.toolEnd({ toolName: "handoff", isError: true });
  assert.ok(!sent.some((message) => message.type === "event" && message.event.kind === "error"));
  handlers.toolEnd({ toolName: "bash", isError: true });
  handlers.toolEnd({ toolName: "handoff", isError: true });
  const error = sent.at(-1);
  assert.ok(error?.type === "event" && error.event.kind === "error");
  assert.match(error.event.text, /2 invalid calls of the tool handoff/);
});

test("settled while a handoff is forced and no tool call came is an error event", async () => {
  const { handlers, sent } = setup(undefined, true);
  handlers.onServerMessage({ type: "handoff" });
  await handlers.settled();
  const error = sent.at(-1);
  assert.ok(error?.type === "event" && error.event.kind === "error");
  assert.match(error.event.text, /without a call of the tool handoff/);
});

test("beforeRequest forces the tool only while a handoff runs; an unknown payload is an error event", () => {
  const { handlers, sent } = setup(undefined, true);
  const payload = { model: "m", tools: [{ name: "handoff", input_schema: {} }] };
  assert.equal(handlers.beforeRequest(payload), undefined);
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(handlers.beforeRequest(payload), { ...payload, tool_choice: { type: "tool", name: "handoff" } });
  assert.equal(handlers.beforeRequest({ model: "m" }), undefined);
  assert.deepEqual(sent.at(-1), {
    type: "event",
    event: { kind: "error", text: "handoff: cannot force a tool for this provider payload: model" },
  });
});

test("shorten keeps short text", () => {
  assert.equal(shorten("abc"), "abc");
  assert.equal(shorten("abcdef", 4), "abc…");
});

test("a gate that throws sends an error event and no settled", async () => {
  const { sent, handlers } = setup(new Error("git status failed"));
  await stopAndDone(handlers);
  assert.deepEqual(sent, [{ type: "event", event: { kind: "error", text: "done gate failed in the subagent: git status failed" } }]);
});

test("handoff commits the changes with the subject, the change lines and the trailer data", async () => {
  const { commits, sent, handlers } = setup();
  await stopAndDone(handlers);
  await handlers.handoff(HANDOFF);
  assert.deepEqual(commits, [{ subject: "scope: what", body: ["a.ts: w", "a.test.ts: t"], change: "fix" }]);
  assert.ok(
    (() => {
      const last = sent.at(-1);
      return last?.type === "handoff" && "commit" in last ? last.commit : undefined;
    })() === "abc123",
  );
});

test("an unfinished handoff starts the body with the reason", async () => {
  const token = setup(GREEN, true);
  token.handlers.onServerMessage({ type: "handoff" });
  await token.handlers.handoff(HANDOFF);
  assert.equal(token.commits[0]?.body[0], "Unfinished: token limit");
  const red = setup({ ok: false, reason: "the repository tests are red" });
  await stopAndDone(red.handlers);
  await stopAndDone(red.handlers);
  await stopAndDone(red.handlers);
  await red.handlers.handoff(HANDOFF);
  assert.equal(red.commits[0]?.body[0], "Unfinished: the repository tests are red");
});

test("no changed files: no commit and no commit sha", async () => {
  const { commits, sent, handlers } = setup(SCOUT_GREEN, false, []);
  await stopAndDone(handlers);
  await handlers.handoff(FINDINGS);
  assert.deepEqual(commits, []);
  assert.ok(
    (() => {
      const last = sent.at(-1);
      return last?.type === "handoff" && "commit" in last ? last.commit : undefined;
    })() === undefined,
  );
});

test("a refused commit throws the git output, sends nothing and counts as an invalid call; the next try commits", async () => {
  const { commits, sent, refusals, handlers } = setup(undefined, true);
  handlers.onServerMessage({ type: "handoff" });
  refusals.push("commit-msg hook: bad subject");
  await assert.rejects(() => handlers.handoff(HANDOFF), /commit-msg hook: bad subject/);
  assert.ok(!sent.some((message) => message.type === "handoff"));
  handlers.toolEnd({ toolName: "handoff", isError: true });
  assert.ok(!sent.some((message) => message.type === "event" && message.event.kind === "error"));
  await handlers.handoff({ ...HANDOFF, subject: "fix: good" });
  assert.equal(commits[0]?.subject, "fix: good");
  assert.ok(
    (() => {
      const last = sent.at(-1);
      return last?.type === "handoff" && "commit" in last ? last.commit : undefined;
    })() === "abc123",
  );
});

test("a settle after an assistant message with stopReason error sends a provider error and nothing else", async () => {
  const { sent, user, calls, handlers } = setup();
  handlers.messageEnd({ role: "assistant", content: [], usage, stopReason: "error", errorMessage: "429 rate limit" });
  await handlers.settled();
  assert.deepEqual(sent.at(-1), { type: "event", event: { kind: "provider_error", text: "429 rate limit" } });
  assert.deepEqual(user, []);
  assert.deepEqual(calls, []);
  await handlers.settled();
  assert.equal(sent.filter((message) => message.type === "event" && message.event.kind === "provider_error").length, 1);
});

test("a good message after an error message (a pi retry) and a new task clear the provider error", async () => {
  const retried = setup();
  retried.handlers.messageEnd({ role: "assistant", content: [], usage, stopReason: "error" });
  retried.handlers.messageEnd({ role: "assistant", content: [], usage, stopReason: "stop" });
  await retried.handlers.settled();
  assert.deepEqual(retried.user, [CHOICE_PROMPT]);
  const renewed = setup();
  renewed.handlers.messageEnd({ role: "assistant", content: [], usage, stopReason: "error" });
  renewed.handlers.onServerMessage({ type: "task", task: "again" });
  await renewed.handlers.settled();
  assert.deepEqual(renewed.user, ["again", CHOICE_PROMPT]);
});

test("a provider error without a message text still reports", async () => {
  const { sent, handlers } = setup();
  handlers.messageEnd({ role: "assistant", content: [], usage, stopReason: "error" });
  await handlers.settled();
  assert.deepEqual(sent.at(-1), { type: "event", event: { kind: "provider_error", text: "the provider returned an error" } });
});
