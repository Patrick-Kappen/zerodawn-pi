import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { onStageResult, onWork, STAGES, type StageResult, stageResult, type WorkRef, workEnd, workStart } from "./outcome.ts";

function listen() {
  const pi = { events: createEventBus() };
  const seen: string[] = [];
  onWork(pi, {
    start: (w) => seen.push(`start ${w.kind}:${w.id} ${w.label}`),
    end: (w: WorkRef) => seen.push(`end ${JSON.stringify(w)}`),
  });
  const results: StageResult[] = [];
  onStageResult(pi, (r) => results.push(r));
  return { pi, seen, results };
}

test("core gets the start and the end of each work", () => {
  const { pi, seen } = listen();
  workStart(pi, { kind: "bash", id: "3.1-C1", label: "just check" });
  workStart(pi, { kind: "subagent", id: "a1", label: "fix lint" });
  workEnd(pi, { kind: "bash", id: "3.1-C1", label: "x" } as WorkRef);
  assert.deepEqual(seen, ["start bash:3.1-C1 just check", "start subagent:a1 fix lint", 'end {"kind":"bash","id":"3.1-C1"}']);
});

test("work without an id or a label fails at the caller and sends nothing", () => {
  const { pi, seen } = listen();
  assert.throws(() => workStart(pi, { kind: "tests", id: " ", label: "all" }), /tests work id is empty/);
  assert.throws(() => workStart(pi, { kind: "lsp", id: "a.ts", label: "" }), /lsp work a.ts: label is empty/);
  assert.throws(() => workEnd(pi, { kind: "opencode", id: "" }), /opencode work id is empty/);
  assert.deepEqual(seen, []);
});

test("core gets each stage result", () => {
  const { pi, results } = listen();
  stageResult(pi, { stage: "format", state: "s1", passed: true });
  stageResult(pi, { stage: "tests", state: "s1", passed: false, report: "2 failed" });
  assert.deepEqual(results, [
    { stage: "format", state: "s1", passed: true },
    { stage: "tests", state: "s1", passed: false, report: "2 failed" },
  ]);
});

test("a stage result without a state, or a failure without a report, fails at the caller", () => {
  const { pi, results } = listen();
  assert.throws(() => stageResult(pi, { stage: "lint", state: "", passed: true }), /lint stage: state is empty/);
  assert.throws(() => stageResult(pi, { stage: "checker", state: "s1", passed: false, report: "" }), /failed checker stage: report is empty/);
  assert.deepEqual(results, []);
});

test("the stages keep the order of the run end", () => {
  assert.deepEqual(STAGES, ["format", "lint", "tests", "checker"]);
});
