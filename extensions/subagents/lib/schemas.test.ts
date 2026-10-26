import assert from "node:assert/strict";
import { test } from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { blockerText, handoffText } from "./format.ts";
import { askSchema, blockerSchema, continueSchema, doneSchema, handoffSchema, MAX_QUESTION, MAX_SUMMARY } from "./schemas.ts";

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

const OK_HANDOFF = {
  summary: "s",
  changes: [{ file: "a.ts", what: "w" }],
  tests: [],
  findings: [],
  decisions: [],
  open: [],
  next: "",
  risks: [],
};

test("handoff: all fields required; summary 1..200; next may be empty; the lists may be empty", () => {
  assert.deepEqual(check("handoff", handoffSchema, OK_HANDOFF)(), OK_HANDOFF);
  for (const key of Object.keys(OK_HANDOFF)) {
    const { [key]: _, ...rest } = OK_HANDOFF as Record<string, unknown>;
    assert.throws(check("handoff", handoffSchema, rest), /Validation failed/);
  }
  assert.equal(check("handoff", handoffSchema, { ...OK_HANDOFF, summary: "x".repeat(MAX_SUMMARY) })().summary.length, MAX_SUMMARY);
  assert.throws(check("handoff", handoffSchema, { ...OK_HANDOFF, summary: "x".repeat(MAX_SUMMARY + 1) }), /Validation failed/);
  assert.throws(check("handoff", handoffSchema, { ...OK_HANDOFF, summary: "" }), /Validation failed/);
  assert.throws(check("handoff", handoffSchema, { ...OK_HANDOFF, changes: [{ file: "a.ts" }] }), /Validation failed/);
  assert.throws(check("handoff", handoffSchema, { ...OK_HANDOFF, tests: [{ file: "t.ts" }] }), /Validation failed/);
  assert.throws(check("handoff", handoffSchema, { ...OK_HANDOFF, findings: [""] }), /Validation failed/);
});

test("done and continue have no parameters", () => {
  assert.deepEqual(check("done", doneSchema, {})(), {});
  assert.deepEqual(check("continue", continueSchema, {})(), {});
});

test("the content texts are short lines", () => {
  assert.equal(blockerText({ issue: "i", files: ["a", "b"], tried: ["x", "y"] }), "i\nfiles: a, b\ntried: x; y");
});

test("handoffText: changes, findings, test line or reason, then only the non-empty lists", () => {
  const gate = { ok: true as const, files: ["a.ts", "a.test.ts"], tests: "green: 12 pass, 0 fail" };
  const base = {
    ...OK_HANDOFF,
    summary: "It works.",
    tests: [
      { file: "a.test.ts", covers: "c" },
      { file: "b.test.ts", covers: "d" },
    ],
  };
  assert.equal(handoffText(base, gate), "It works.\na.ts: w\ntests: green: 12 pass, 0 fail; added: a.test.ts, b.test.ts");
  assert.equal(handoffText({ ...base, tests: [] }, gate), "It works.\na.ts: w\ntests: green: 12 pass, 0 fail");
  assert.equal(
    handoffText({ ...base, decisions: ["x", "y"], open: ["z"], next: "n", risks: ["r"] }, gate),
    "It works.\na.ts: w\ntests: green: 12 pass, 0 fail; added: a.test.ts, b.test.ts\ndecisions: x; y\nopen: z\nnext: n\nrisks: r",
  );
  assert.equal(
    handoffText({ ...base, changes: [], tests: [], findings: ["a:1 f", "b:2 g"] }, gate),
    "S\na:1 f\nb:2 g\ntests: green: 12 pass, 0 fail".replace("S", "It works."),
  );
  assert.equal(handoffText(base, undefined, "tests red"), "It works.\na.ts: w\ngate red: tests red");
  assert.equal(handoffText(base), "It works.\na.ts: w");
});
