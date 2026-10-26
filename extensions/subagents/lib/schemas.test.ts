import assert from "node:assert/strict";
import { test } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { blockerText, handoffText } from "./format.ts";
import { askSchema, blockerSchema, handoffSchema, MAX_QUESTION } from "./schemas.ts";

function check(name: string, parameters: unknown, args: unknown) {
  return () => validateToolArguments({ name, parameters } as never, { type: "toolCall", id: "1", name, arguments: args } as never);
}

test("ask: a question up to 500 characters passes, a longer one gives an error", () => {
  assert.deepEqual(check("ask", askSchema, { question: "x".repeat(MAX_QUESTION) })(), { question: "x".repeat(MAX_QUESTION) });
  assert.throws(check("ask", askSchema, { question: "x".repeat(MAX_QUESTION + 1) }), /Validation failed for tool "ask"[\s\S]*question/);
  assert.throws(check("ask", askSchema, {}), /Validation failed/);
});

test("blocker: all fields required, issue not empty, tried has an entry", () => {
  const ok = { issue: "i", files: [], tried: ["t"] };
  assert.deepEqual(check("blocker", blockerSchema, ok)(), ok);
  for (const key of ["issue", "files", "tried"]) {
    const { [key]: _, ...rest } = ok as Record<string, unknown>;
    assert.throws(check("blocker", blockerSchema, rest), /Validation failed/);
  }
  assert.throws(check("blocker", blockerSchema, { ...ok, issue: "" }), /Validation failed/);
  assert.throws(check("blocker", blockerSchema, { ...ok, tried: [] }), /Validation failed/);
});

test("handoff: all fields required, next and tests not empty", () => {
  const ok = { done: [], open: [], next: "n", files: [], risks: [], tests: "t" };
  assert.deepEqual(check("handoff", handoffSchema, ok)(), ok);
  for (const key of Object.keys(ok)) {
    const { [key]: _, ...rest } = ok as Record<string, unknown>;
    assert.throws(check("handoff", handoffSchema, rest), /Validation failed/);
  }
  assert.throws(check("handoff", handoffSchema, { ...ok, next: "" }), /Validation failed/);
  assert.throws(check("handoff", handoffSchema, { ...ok, tests: "" }), /Validation failed/);
});

test("the content texts are short lines", () => {
  assert.equal(blockerText({ issue: "i", files: ["a", "b"], tried: ["x", "y"] }), "i\nfiles: a, b\ntried: x; y");
  assert.equal(
    handoffText({ done: ["a", "b"], open: ["c"], next: "n", files: ["f", "g"], risks: ["r"], tests: "t" }),
    "done: a; b\nopen: c\nnext: n\nfiles: f, g\nrisks: r\ntests: t",
  );
});
