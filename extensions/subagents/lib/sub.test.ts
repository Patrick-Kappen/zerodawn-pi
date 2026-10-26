import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage } from "./protocol.ts";
import { createSubHandlers, readSubEnv, shorten } from "./sub.ts";

function setup() {
  const sent: ClientMessage[] = [];
  const user: string[] = [];
  const handlers = createSubHandlers({ send: (message) => sent.push(message), sendUserMessage: (text) => user.push(text) });
  return { sent, user, handlers };
}

const usage = { totalTokens: 10, cost: { total: 0.02 } };

test("readSubEnv: none set is a main pi, both set is a subagent, one set fails", () => {
  assert.equal(readSubEnv({}), undefined);
  assert.deepEqual(readSubEnv({ PI_SUBAGENT_SOCKET: "/s", PI_SUBAGENT_ID: "i" }), { socket: "/s", id: "i" });
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

test("settled sends the full final text of the last assistant message", () => {
  const { sent, handlers } = setup();
  const long = "z".repeat(1000);
  handlers.messageEnd({ role: "assistant", content: [{ type: "text", text: "first" }], usage });
  handlers.messageEnd({ role: "assistant", content: [{ type: "text", text: long }], usage });
  handlers.settled();
  assert.deepEqual(sent.at(-1), { type: "event", event: { kind: "settled", text: long } });
  handlers.settled();
  assert.deepEqual(sent.at(-1), { type: "event", event: { kind: "settled", text: "" } });
});

test("shorten keeps short text", () => {
  assert.equal(shorten("abc"), "abc");
  assert.equal(shorten("abcdef", 4), "abc…");
});
