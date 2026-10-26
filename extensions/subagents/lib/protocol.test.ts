import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClientMessage, formatServerMessage, parseClientLine, parseServerLine } from "./protocol.ts";

const usage = { tokens: 5, cost: 0.01 };

test("parseClientLine accepts hello, status, start and events", () => {
  assert.deepEqual(parseClientLine('{"type":"hello","role":"main"}'), { type: "hello", role: "main" });
  assert.deepEqual(parseClientLine('{"type":"hello","role":"sub","id":"a"}'), { type: "hello", role: "sub", id: "a" });
  assert.deepEqual(parseClientLine('{"type":"status","extra":1}'), { type: "status" });
  assert.deepEqual(parseClientLine('{"type":"start","task":"t","args":["--a","b c"],"checks":["just lint"]}'), {
    type: "start",
    task: "t",
    args: ["--a", "b c"],
    checks: ["just lint"],
  });
  for (const event of [
    { kind: "tool_start", name: "bash", args: "{}" },
    { kind: "tool_end", name: "bash", isError: false },
    { kind: "message", text: "x", usage },
    { kind: "settled", text: "x" },
    { kind: "gate", ok: false, text: "tests red" },
  ]) {
    assert.deepEqual(parseClientLine(formatClientMessage({ type: "event", event } as never)), { type: "event", event });
  }
});

test("parseClientLine accepts answer, ask and blocker", () => {
  assert.deepEqual(parseClientLine('{"type":"answer","id":"a","text":"t"}'), { type: "answer", id: "a", text: "t" });
  assert.deepEqual(parseClientLine('{"type":"ask","text":"q"}'), { type: "ask", text: "q" });
  assert.deepEqual(parseClientLine('{"type":"blocker","text":"r"}'), { type: "blocker", text: "r" });
  assert.throws(() => parseClientLine('{"type":"answer","text":"t"}'), /field "id"/);
  assert.throws(() => parseClientLine('{"type":"answer","id":"a"}'), /field "text"/);
  assert.throws(() => parseClientLine('{"type":"ask"}'), /field "text"/);
  assert.throws(() => parseClientLine('{"type":"blocker","text":1}'), /field "text"/);
});

test("parseClientLine rejects bad lines with a reason", () => {
  assert.throws(() => parseClientLine("nope"), /not valid JSON/);
  assert.throws(() => parseClientLine("[1]"), /not a JSON object/);
  assert.throws(() => parseClientLine("null"), /not a JSON object/);
  assert.throws(() => parseClientLine('{"type":"hello","role":"x"}'), /Use "main" or "sub"/);
  assert.throws(() => parseClientLine('{"type":"hello"}'), /Use "main" or "sub"/);
  assert.throws(() => parseClientLine('{"type":"hello","role":"sub"}'), /field "id"/);
  assert.throws(() => parseClientLine('{"type":"start"}'), /field "task"/);
  assert.throws(() => parseClientLine('{"type":"start","task":"t"}'), /field "args"/);
  assert.throws(() => parseClientLine('{"type":"start","task":"t","args":[1],"checks":[]}'), /field "args"/);
  assert.throws(() => parseClientLine('{"type":"start","task":"t","args":[]}'), /field "checks"/);
  assert.throws(() => parseClientLine('{"type":"start","task":"t","args":[],"checks":[1]}'), /field "checks"/);
  assert.throws(() => parseClientLine('{"type":"event","event":{"kind":"gate","ok":"no","text":""}}'), /field "ok"/);
  assert.throws(() => parseClientLine('{"type":"event"}'), /field "event"/);
  assert.throws(() => parseClientLine('{"type":"event","event":{"kind":"x"}}'), /unknown event kind/);
  assert.throws(() => parseClientLine('{"type":"event","event":{"kind":"tool_end","name":"a"}}'), /"isError"/);
  assert.throws(() => parseClientLine('{"type":"event","event":{"kind":"message","text":"a"}}'), /"usage"/);
  assert.throws(() => parseClientLine('{"type":"event","event":{"kind":"message","text":"a","usage":{"tokens":"1","cost":1}}}'), /"tokens"/);
  assert.throws(() => parseClientLine('{"type":"zzz"}'), /unknown message type/);
});

test("formatServerMessage ends with one newline", () => {
  assert.equal(formatServerMessage({ type: "error", message: "x" }), '{"type":"error","message":"x"}\n');
});

test("parseServerLine reads every server message and rejects the rest", () => {
  assert.deepEqual(parseServerLine('{"type":"status","agents":[],"main":"connected"}'), { type: "status", agents: [], main: "connected" });
  assert.deepEqual(parseServerLine('{"type":"error","message":"x"}'), { type: "error", message: "x" });
  assert.deepEqual(parseServerLine('{"type":"started","id":"a"}'), { type: "started", id: "a" });
  assert.deepEqual(parseServerLine('{"type":"task","task":"t"}'), { type: "task", task: "t" });
  assert.deepEqual(parseServerLine('{"type":"handoff"}'), { type: "handoff" });
  const result = { type: "result" as const, id: "a", status: "idle" as const, text: "t", usage, events: ["e"] };
  assert.deepEqual(parseServerLine(formatServerMessage(result)), result);
  for (const status of ["question", "blocked"] as const) {
    const pending = { ...result, status };
    assert.deepEqual(parseServerLine(formatServerMessage(pending)), pending);
  }
  assert.throws(() => parseServerLine("nope"), /not valid JSON/);
  assert.throws(() => parseServerLine('{"type":"status","main":"x"}'), /unknown message/);
  assert.throws(() => parseServerLine('{"type":"result","id":"a","status":"x","text":"","usage":{},"events":[]}'), /unknown message/);
  assert.throws(() => parseServerLine('{"type":"result","id":"a","status":"idle","text":"","usage":{},"events":[1]}'), /unknown message/);
  assert.throws(() => parseServerLine("null"), /not a JSON object/);
});
