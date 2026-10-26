import assert from "node:assert/strict";
import { test } from "node:test";
import type { GateResult } from "./gate.ts";
import type { ClientMessage } from "./protocol.ts";
import { createSubHandlers, DONE_PROMPT, GATE_HANDOFF_PROMPT, HANDOFF_PROMPT, readSubEnv, shorten } from "./sub.ts";

const HANDOFF = { done: ["a"], open: ["b"], next: "c", files: ["f"], risks: [], tests: "green" };

const GREEN: GateResult = { ok: true, reason: "tests and checks green", files: ["a.ts", "a.test.ts"], tests: "green: 3 pass, 0 fail" };
const SCOUT_GREEN: GateResult = { ok: true, reason: "no changed files", files: [], tests: "not run: no changed files" };
const DONE = {
  summary: "It works.",
  changes: [
    { file: "a.ts", what: "w" },
    { file: "a.test.ts", what: "t" },
  ],
  tests: [{ file: "a.test.ts", covers: "c" }],
  decisions: [],
  open: [],
};

function setup(result: GateResult | Error = GREEN, idle = false, changed = ["a.ts", "a.test.ts"]) {
  const sent: ClientMessage[] = [];
  const user: string[] = [];
  let gates = 0;
  const calls: string[] = [];
  const handlers = createSubHandlers({
    send: (message) => sent.push(message),
    sendUserMessage: (text) => user.push(text),
    abort: () => calls.push("abort"),
    isIdle: () => idle,
    getActiveTools: () => ["read", "ask"],
    setActiveTools: (names) => calls.push(`tools ${names.join(",")}`),
    changed: () => changed,
    gate: async (send) => {
      gates++;
      if (result instanceof Error) throw result;
      if (!result.ok) send("fix it");
      return result;
    },
  });
  return { sent, user, handlers, gates: () => gates, calls };
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
  assert.throws(() => handlers.onServerMessage({ type: "started", id: "a" }), /sent "started"/);
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

test("a green gate forces the tool done with the gate data; the model data goes out with the gate", async () => {
  const { sent, user, calls, handlers } = setup();
  await handlers.settled();
  assert.deepEqual(sent, [{ type: "event", event: { kind: "gate", ok: true, text: "tests and checks green" } }]);
  assert.deepEqual(user, [DONE_PROMPT]);
  assert.deepEqual(calls, ["tools done"]);
  assert.deepEqual(handlers.beforeRequest({ tools: [{ name: "done", input_schema: {} }] }), {
    tools: [{ name: "done", input_schema: {} }],
    tool_choice: { type: "tool", name: "done" },
  });
  assert.match(handlers.done(DONE), /Done sent/);
  assert.deepEqual(sent.at(-1), { type: "done", data: DONE, gate: { ok: true, files: ["a.ts", "a.test.ts"], tests: "green: 3 pass, 0 fail" } });
  sent.length = 0;
  await handlers.settled();
  assert.deepEqual(sent, []);
  assert.equal(handlers.beforeRequest({ tools: [{ name: "done", input_schema: {} }] }), undefined);
});

test("a new task after done restores the tools and the gate runs again", async () => {
  const { user, calls, handlers, gates } = setup();
  await handlers.settled();
  handlers.done(DONE);
  handlers.onServerMessage({ type: "task", task: "more" });
  assert.deepEqual(calls, ["tools done", "tools read,ask"]);
  assert.deepEqual(user, [DONE_PROMPT, "more"]);
  await handlers.settled();
  assert.equal(gates(), 2);
  assert.deepEqual(user.at(-1), DONE_PROMPT);
});

test("a green gate without changed files forces done_findings", async () => {
  const { sent, calls, handlers } = setup(SCOUT_GREEN, false, []);
  await handlers.settled();
  assert.deepEqual(calls, ["tools done_findings"]);
  assert.throws(() => handlers.done(DONE), /not active/);
  const findings = { summary: "S", findings: ["a.ts:1 x"] };
  assert.match(handlers.doneFindings(findings), /Done sent/);
  assert.deepEqual(sent.at(-1), { type: "done", data: findings, gate: { ok: true, files: [], tests: "not run: no changed files" } });
});

test("done before it is forced fails", () => {
  const { handlers } = setup();
  assert.throws(() => handlers.done(DONE), /not active/);
  assert.throws(() => handlers.doneFindings({ summary: "s", findings: ["x"] }), /not active/);
});

test("done checks changes against git: a missing file, an extra file, and an exact match", async () => {
  const missing = setup(GREEN, false, ["a.ts", "a.test.ts", "b.ts"]);
  await missing.handlers.settled();
  assert.throws(() => missing.handlers.done(DONE), /Changed: a\.ts, a\.test\.ts, b\.ts\. Listed: a\.ts, a\.test\.ts\. Not changed: none\. Missing: b\.ts\./);
  const extra = setup(GREEN, false, ["a.ts"]);
  await extra.handlers.settled();
  assert.throws(() => extra.handlers.done(DONE), /Not changed: a\.test\.ts\. Missing: none\./);
  assert.ok(!extra.sent.some((message) => message.type === "done"));
  const ok = setup(GREEN, false, ["a.test.ts", "a.ts"]);
  await ok.handlers.settled();
  assert.match(ok.handlers.done(DONE), /Done sent/);
});

test("two invalid done calls send an error event; a valid call between is not needed", async () => {
  const { handlers, sent } = setup();
  await handlers.settled();
  handlers.toolEnd({ toolName: "done", isError: true });
  assert.ok(!sent.some((message) => message.type === "event" && message.event.kind === "error"));
  handlers.toolEnd({ toolName: "done", isError: true });
  const error = sent.at(-1);
  assert.ok(error?.type === "event" && error.event.kind === "error");
  assert.match(error.event.text, /2 invalid calls of the tool done/);
});

test("two invalid done_findings calls fail the agent", async () => {
  const { handlers, sent } = setup(SCOUT_GREEN, false, []);
  await handlers.settled();
  handlers.toolEnd({ toolName: "done_findings", isError: true });
  handlers.toolEnd({ toolName: "done_findings", isError: true });
  const error = sent.at(-1);
  assert.ok(error?.type === "event" && error.event.kind === "error");
  assert.match(error.event.text, /2 invalid calls of the tool done_findings/);
});

test("settled while done is forced and no call came is an error event", async () => {
  const { handlers, sent } = setup();
  await handlers.settled();
  await handlers.settled();
  const error = sent.at(-1);
  assert.ok(error?.type === "event" && error.event.kind === "error");
  assert.match(error.event.text, /without a call of the tool done/);
});

test("settled with a red gate sends only the gate event and keeps the agent running", async () => {
  const { sent, handlers } = setup({ ok: false, reason: "the repository tests are red" });
  handlers.messageEnd({ role: "assistant", content: [{ type: "text", text: "done" }], usage });
  sent.length = 0;
  await handlers.settled();
  assert.deepEqual(sent, [{ type: "event", event: { kind: "gate", ok: false, text: "the repository tests are red" } }]);
});

test("settled skips the gate after ask or blocker, once", async () => {
  const { sent, handlers, gates } = setup();
  handlers.ask("which db?");
  await handlers.settled();
  assert.equal(gates(), 0);
  assert.deepEqual(sent.at(-1), { type: "event", event: { kind: "settled", text: "" } });
  handlers.blocker({ issue: "no access", files: [], tried: ["x"] });
  await handlers.settled();
  assert.equal(gates(), 0);
  await handlers.settled();
  assert.equal(gates(), 1);
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
  await handlers.settled();
  await handlers.settled();
  assert.deepEqual(user, ["fix it", "fix it"]);
  sent.length = 0;
  await handlers.settled();
  assert.deepEqual(user, ["fix it", "fix it", GATE_HANDOFF_PROMPT]);
  assert.deepEqual(calls, ["tools handoff"]);
  assert.deepEqual(sent, [{ type: "event", event: { kind: "gate", ok: false, text: "the repository tests are red" } }]);
  assert.match(handlers.handoff(HANDOFF), /Handoff sent/);
  assert.deepEqual(sent.at(-1), { type: "handoff", data: HANDOFF, reason: "the repository tests are red" });
  sent.length = 0;
  await handlers.settled();
  assert.deepEqual(sent, []);
});

test("a new task resets the red gate count", async () => {
  const { user, sent, handlers } = setup({ ok: false, reason: "red" });
  await handlers.settled();
  await handlers.settled();
  handlers.onServerMessage({ type: "task", task: "again" });
  await handlers.settled();
  await handlers.settled();
  assert.deepEqual(user, ["fix it", "fix it", "again", "fix it", "fix it"]);
  assert.ok(!sent.some((message) => message.type === "event" && message.event.kind === "error"));
});

test("a handoff message aborts, sets only the tool handoff and sends the prompt at the next settle", async () => {
  const { handlers, gates, calls, user, sent } = setup();
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(calls, ["abort", "tools handoff"]);
  assert.deepEqual(user, []);
  await handlers.settled();
  assert.deepEqual(user, [HANDOFF_PROMPT]);
  assert.equal(gates(), 0);
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(calls, ["abort", "tools handoff"]);
  assert.match(handlers.handoff(HANDOFF), /Handoff sent\. Stop\./);
  assert.deepEqual(sent, [{ type: "handoff", data: HANDOFF }]);
  await handlers.settled();
  assert.equal(gates(), 0);
  assert.equal(sent.length, 1);
});

test("a handoff message on an idle agent sends the prompt at once", () => {
  const { handlers, user } = setup(undefined, true);
  handlers.onServerMessage({ type: "handoff" });
  assert.deepEqual(user, [HANDOFF_PROMPT]);
});

test("the tool handoff fails before a handoff is asked for", () => {
  const { handlers } = setup();
  assert.throws(() => handlers.handoff(HANDOFF), /not active/);
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
  await handlers.settled();
  assert.deepEqual(sent, [{ type: "event", event: { kind: "error", text: "done gate failed in the subagent: git status failed" } }]);
});
