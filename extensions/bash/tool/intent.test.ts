import assert from "node:assert/strict";
import { test } from "node:test";
import { aloneInMessage } from "./intent.ts";

const call = (id: string) => ({ type: "toolCall", id, name: "bash", arguments: { command: "ls" } });
const assistant = (...content: unknown[]) => ({ type: "message", message: { role: "assistant", content } });
const result = (id: string) => ({ type: "message", message: { role: "toolResult", toolCallId: id, content: [] } });

test("the only tool call of its message is alone", () => {
  assert.equal(aloneInMessage([assistant({ type: "text", text: "go" }, call("a"))], "a"), true);
});

test("a call beside other tool calls is not alone", () => {
  assert.equal(aloneInMessage([assistant(call("a"), call("b"))], "b"), false);
});

test("the message of the call counts, not the last message", () => {
  const entries = [assistant(call("a")), result("a"), assistant(call("b"), call("c"))];
  assert.equal(aloneInMessage(entries, "a"), true);
  assert.equal(aloneInMessage(entries, "c"), false);
});

test("a call in no message (a nested call) is not alone", () => {
  assert.equal(aloneInMessage([assistant(call("a"))], "codemode-1"), false);
  assert.equal(aloneInMessage([], "a"), false);
});
