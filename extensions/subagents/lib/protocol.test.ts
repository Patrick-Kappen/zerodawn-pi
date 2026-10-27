import assert from "node:assert/strict";
import { test } from "node:test";
import { formatClientMessage, formatServerMessage, parseClientLine, parseServerLine } from "./protocol.ts";

const usage = { tokens: 5, cost: 0.01 };
const handoff = {
  subject: "scope: what",
  summary: "s",
  change: "fix" as const,
  changes: [{ file: "a.ts", what: "w" }],
  tests: [{ file: "a.test.ts", covers: "c" }],
  findings: [],
  decisions: ["d"],
  open: ["o"],
  next: "n",
  risks: [],
};

test("parseClientLine accepts hello, status, start and events", () => {
  assert.deepEqual(parseClientLine('{"type":"hello","role":"main"}'), { type: "hello", role: "main" });
  assert.deepEqual(parseClientLine('{"type":"hello","role":"sub","id":"a"}'), { type: "hello", role: "sub", id: "a" });
  assert.deepEqual(parseClientLine('{"type":"status","requestId":"1","extra":1}'), { type: "status", requestId: "1" });
  assert.deepEqual(
    parseClientLine(
      '{"type":"start","requestId":"1","task":"t","args":["--a","b c"],"checks":["just lint"],"models":["a/b:low","c/d"],"repo":"/r","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    ),
    {
      type: "start",
      requestId: "1",
      task: "t",
      args: ["--a", "b c"],
      checks: ["just lint"],
      models: ["a/b:low", "c/d"],
      repo: "/r",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  );
  assert.deepEqual(parseClientLine('{"type":"discard","requestId":"1","id":"a"}'), { type: "discard", requestId: "1", id: "a" });
  assert.throws(
    () =>
      parseClientLine(
        '{"type":"start","requestId":"1","task":"t","args":[],"checks":[],"models":["a/b"],"repo":"r","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      ),
    /absolute/,
  );
  assert.throws(
    () => parseClientLine('{"type":"start","requestId":"1","task":"t","args":[],"checks":[],"models":["a/b"],"repo":"/r","sha":"main"}'),
    /commit hash/,
  );
  assert.deepEqual(parseServerLine('{"type":"discarded","requestId":"1","id":"a","text":"t"}'), { type: "discarded", requestId: "1", id: "a", text: "t" });
  for (const event of [
    { kind: "tool_start", name: "bash", args: "{}" },
    { kind: "tool_end", name: "bash", isError: false },
    { kind: "message", text: "x", usage },
    { kind: "settled", text: "x" },
    { kind: "gate", ok: false, text: "tests red" },
    { kind: "provider_error", text: "429 rate limit" },
  ]) {
    assert.deepEqual(parseClientLine(formatClientMessage({ type: "event", event } as never)), { type: "event", event });
  }
});

test("parseClientLine accepts answer, ask and blocker", () => {
  assert.deepEqual(parseClientLine('{"type":"answer","requestId":"1","id":"a","text":"t"}'), { type: "answer", requestId: "1", id: "a", text: "t" });
  assert.deepEqual(parseClientLine('{"type":"ask","text":"q"}'), { type: "ask", text: "q" });
  const blocker = { issue: "i", files: ["f"], tried: ["t"] };
  assert.deepEqual(parseClientLine(formatClientMessage({ type: "blocker", data: blocker })), { type: "blocker", data: blocker });
  assert.deepEqual(parseClientLine(formatClientMessage({ type: "handoff", data: handoff })), { type: "handoff", data: handoff });
  assert.deepEqual(parseClientLine(formatClientMessage({ type: "handoff", data: handoff, reason: "r" })), { type: "handoff", data: handoff, reason: "r" });
  assert.throws(() => parseClientLine('{"type":"handoff","data":{"subject":"s: x","summary":"s","change":"fix"}}'), /field "changes"/);
  assert.throws(() => parseClientLine('{"type":"answer","requestId":"1","text":"t"}'), /field "id"/);
  assert.throws(() => parseClientLine('{"type":"answer","requestId":"1","id":"a"}'), /field "text"/);
  assert.throws(() => parseClientLine('{"type":"ask"}'), /field "text"/);
  assert.throws(() => parseClientLine('{"type":"blocker","data":{"issue":"i","files":"f","tried":[]}}'), /field "files".*list of strings/);
  assert.throws(() => parseClientLine('{"type":"blocker","text":"r"}'), /field "data"/);
});

test("parseClientLine and parseServerLine carry the handoff gate", () => {
  const gate = { ok: true as const, files: ["a.ts"], tests: "green: 1 pass" };
  const commit = "a".repeat(40);
  assert.deepEqual(parseClientLine(formatClientMessage({ type: "handoff", data: handoff, gate, commit })), { type: "handoff", data: handoff, gate, commit });
  const result = { type: "result" as const, id: "a", status: "idle" as const, text: "t", usage, events: [], model: "a/b", handoff, gate, commit };
  assert.deepEqual(parseServerLine(formatServerMessage(result)), result);
  assert.throws(() => parseClientLine(formatClientMessage({ type: "handoff", data: handoff, gate: { ...gate, ok: false } as never })), /field "ok"/);
  assert.throws(() => parseClientLine('{"type":"done","data":{},"gate":{}}'), /unknown message type "done"/);
});

test("parseClientLine rejects bad lines with a reason", () => {
  assert.throws(() => parseClientLine("nope"), /not valid JSON/);
  assert.throws(() => parseClientLine("[1]"), /not a JSON object/);
  assert.throws(() => parseClientLine("null"), /not a JSON object/);
  assert.throws(() => parseClientLine('{"type":"hello","role":"x"}'), /Use "main" or "sub"/);
  assert.throws(() => parseClientLine('{"type":"hello"}'), /Use "main" or "sub"/);
  assert.throws(() => parseClientLine('{"type":"hello","role":"sub"}'), /field "id"/);
  assert.throws(() => parseClientLine('{"type":"start","requestId":"1"}'), /field "task"/);
  assert.throws(() => parseClientLine('{"type":"start","requestId":"1","task":"t"}'), /field "args"/);
  assert.throws(() => parseClientLine('{"type":"start","requestId":"1","task":"t","args":[1],"checks":[]}'), /field "args"/);
  assert.throws(() => parseClientLine('{"type":"start","requestId":"1","task":"t","args":[]}'), /field "checks"/);
  assert.throws(() => parseClientLine('{"type":"start","requestId":"1","task":"t","args":[],"checks":[1]}'), /field "checks"/);
  assert.throws(() => parseClientLine('{"type":"start","requestId":"1","task":"t","args":[],"checks":[],"repo":"/r"}'), /field "models"/);
  assert.throws(
    () => parseClientLine('{"type":"start","requestId":"1","task":"t","args":[],"checks":[],"models":[],"repo":"/r"}'),
    /"models" of "start" must not be empty/,
  );
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
  assert.deepEqual(parseServerLine('{"type":"status","requestId":"1","agents":[],"main":"connected"}'), {
    type: "status",
    requestId: "1",
    agents: [],
    main: "connected",
  });
  assert.deepEqual(parseServerLine('{"type":"error","message":"x"}'), { type: "error", message: "x" });
  assert.deepEqual(parseServerLine('{"type":"started","requestId":"1","id":"a"}'), { type: "started", requestId: "1", id: "a" });
  assert.deepEqual(parseServerLine('{"type":"task","task":"t"}'), { type: "task", task: "t" });
  assert.deepEqual(parseServerLine('{"type":"handoff"}'), { type: "handoff" });
  const result = { type: "result" as const, id: "a", status: "idle" as const, text: "t", usage, events: ["e"], model: "a/b" };
  assert.deepEqual(parseServerLine(formatServerMessage(result)), result);
  for (const status of ["question", "blocked"] as const) {
    const pending = { ...result, status };
    assert.deepEqual(parseServerLine(formatServerMessage(pending)), pending);
  }
  const full = {
    ...result,
    status: "handoff" as const,
    blocker: { issue: "i", files: [], tried: ["t"] },
    handoff,
    reason: "r",
    failedModels: [{ model: "c/d", reason: "429" }],
  };
  assert.deepEqual(parseServerLine(formatServerMessage(full)), full);
  assert.throws(() => parseServerLine("nope"), /not valid JSON/);
  assert.throws(() => parseServerLine('{"type":"status","requestId":"1","main":"x"}'), /unknown message/);
  assert.throws(() => parseServerLine('{"type":"result","id":"a","status":"x","text":"","usage":{},"events":[]}'), /unknown message/);
  assert.throws(() => parseServerLine('{"type":"result","id":"a","status":"idle","text":"","usage":{},"events":[1]}'), /unknown message/);
  assert.throws(() => parseServerLine("null"), /not a JSON object/);
});
