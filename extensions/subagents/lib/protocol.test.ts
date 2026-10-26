import assert from "node:assert/strict";
import { test } from "node:test";
import { formatServerMessage, parseClientLine } from "./protocol.ts";

test("parseClientLine accepts hello main and status", () => {
  assert.deepEqual(parseClientLine('{"type":"hello","role":"main"}'), { type: "hello", role: "main" });
  assert.deepEqual(parseClientLine('{"type":"status","extra":1}'), { type: "status" });
});

test("parseClientLine rejects bad lines with a reason", () => {
  assert.throws(() => parseClientLine("nope"), /not valid JSON/);
  assert.throws(() => parseClientLine("[1]"), /not a JSON object/);
  assert.throws(() => parseClientLine("null"), /not a JSON object/);
  assert.throws(() => parseClientLine('{"type":"hello","role":"x"}'), /Only role "main"/);
  assert.throws(() => parseClientLine('{"type":"hello"}'), /Only role "main"/);
  assert.throws(() => parseClientLine('{"type":"zzz"}'), /unknown message type/);
});

test("formatServerMessage ends with one newline", () => {
  assert.equal(formatServerMessage({ type: "error", message: "x" }), '{"type":"error","message":"x"}\n');
});
