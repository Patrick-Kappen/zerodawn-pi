import assert from "node:assert/strict";
import { test } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { blockerText, doneText, handoffText } from "./format.ts";
import { askSchema, blockerSchema, doneFindingsSchema, doneSchema, handoffSchema, MAX_QUESTION, MAX_SUMMARY } from "./schemas.ts";

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

test("done: summary 1..200, at least one change, the other lists may be empty", () => {
  const ok = { summary: "s", changes: [{ file: "a.ts", what: "w" }], tests: [], decisions: [], open: [] };
  assert.deepEqual(check("done", doneSchema, ok)(), ok);
  for (const key of Object.keys(ok)) {
    const { [key]: _, ...rest } = ok as Record<string, unknown>;
    assert.throws(check("done", doneSchema, rest), /Validation failed/);
  }
  assert.deepEqual(check("done", doneSchema, { ...ok, summary: "x".repeat(MAX_SUMMARY) })().summary.length, MAX_SUMMARY);
  assert.throws(check("done", doneSchema, { ...ok, summary: "x".repeat(MAX_SUMMARY + 1) }), /Validation failed/);
  assert.throws(check("done", doneSchema, { ...ok, summary: "" }), /Validation failed/);
  assert.throws(check("done", doneSchema, { ...ok, changes: [] }), /Validation failed/);
  assert.throws(check("done", doneSchema, { ...ok, changes: [{ file: "a.ts" }] }), /Validation failed/);
  assert.throws(check("done", doneSchema, { ...ok, tests: [{ file: "t.ts" }] }), /Validation failed/);
});

test("done_findings: summary 1..200, at least one finding", () => {
  const ok = { summary: "s", findings: ["a.ts:1 x"] };
  assert.deepEqual(check("done_findings", doneFindingsSchema, ok)(), ok);
  assert.throws(check("done_findings", doneFindingsSchema, { ...ok, findings: [] }), /Validation failed/);
  assert.throws(check("done_findings", doneFindingsSchema, { ...ok, summary: "x".repeat(MAX_SUMMARY + 1) }), /Validation failed/);
  assert.throws(check("done_findings", doneFindingsSchema, { summary: "s" }), /Validation failed/);
});

test("doneText: changes, tests line, optional decisions and open; scout: summary and findings", () => {
  const gate = { ok: true as const, files: ["a.ts", "a.test.ts"], tests: "green: 12 pass, 0 fail" };
  const base = {
    summary: "It works.",
    changes: [{ file: "a.ts", what: "w" }],
    tests: [
      { file: "a.test.ts", covers: "c" },
      { file: "b.test.ts", covers: "d" },
    ],
  };
  assert.equal(doneText({ ...base, decisions: [], open: [] }, gate), "It works.\na.ts: w\ntests: green: 12 pass, 0 fail; added: a.test.ts, b.test.ts");
  assert.equal(doneText({ ...base, tests: [], decisions: [], open: [] }, gate), "It works.\na.ts: w\ntests: green: 12 pass, 0 fail");
  assert.equal(
    doneText({ ...base, decisions: ["x", "y"], open: ["z"] }, gate),
    "It works.\na.ts: w\ntests: green: 12 pass, 0 fail; added: a.test.ts, b.test.ts\ndecisions: x; y\nopen: z",
  );
  assert.equal(doneText({ summary: "S", findings: ["a:1 f", "b:2 g"] }, gate), "S\na:1 f\nb:2 g");
});
