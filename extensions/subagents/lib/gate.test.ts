import assert from "node:assert/strict";
import { test } from "node:test";
import type { Run } from "../../../shared/testrun.ts";
import { type GateDeps, runGate } from "./gate.ts";

const green: Run = { output: "3 pass\n0 fail", code: 0, timedOut: false, ms: 1 };
const red = (output: string): Run => ({ output, code: 1, timedOut: false, ms: 1 });

function setup(over: Partial<GateDeps> & { runs?: Run[] } = {}) {
  const messages: string[] = [];
  const ran: string[][] = [];
  const runs = [...(over.runs ?? [])];
  const deps: GateDeps = {
    checks: [],
    changed: () => ["a.ts"],
    uncovered: () => [],
    testCommand: () => ["just", "test"],
    run: async (argv) => {
      ran.push(argv);
      return runs.shift() ?? green;
    },
    sendUserMessage: (text) => messages.push(text),
    ...over,
  };
  return { deps, messages, ran };
}

test("no changed files: the gate passes at once", async () => {
  const { deps, messages, ran } = setup({ changed: () => [] });
  assert.deepEqual(await runGate(deps), { ok: true, reason: "no changed files" });
  assert.deepEqual([messages, ran], [[], []]);
});

test("a changed code file without a test: red message with the files, nothing runs", async () => {
  const { deps, messages, ran } = setup({ uncovered: () => ["a.ts", "b.ts"] });
  assert.deepEqual(await runGate(deps), { ok: false, reason: "no test for 2 changed files" });
  assert.match(messages[0] as string, /No test for: a\.ts, b\.ts\. Add a test file/);
  assert.deepEqual(ran, []);
});

test("no way to run every test: red message with the error", async () => {
  const { deps, messages } = setup({
    testCommand: () => {
      throw new Error("run_tests: no way to run every test in /x");
    },
  });
  assert.equal((await runGate(deps)).ok, false);
  assert.match(messages[0] as string, /no way to run every test in \/x/);
});

test("red tests: only the failures go back; the checks do not run", async () => {
  const { deps, messages, ran } = setup({ runs: [red("(pass) ok\n(fail) a > breaks\nerror: boom")], checks: ["just lint"] });
  assert.deepEqual(await runGate(deps), { ok: false, reason: "the repository tests are red" });
  assert.match(messages[0] as string, /Command: just test\n.*\(fail\) a > breaks.*\nerror: boom/s);
  assert.doesNotMatch(messages[0] as string, /\(pass\)/);
  assert.deepEqual(ran, [["just", "test"]]);
});

test("a warning in the test output is red", async () => {
  const { deps, messages } = setup({ runs: [{ ...green, output: "3 pass\nwarn: deprecated" }] });
  assert.equal((await runGate(deps)).ok, false);
  assert.match(messages[0] as string, /1 warning lines/);
});

test("a red check: the failing command and its failures go back", async () => {
  const { deps, messages, ran } = setup({ checks: ["just lint", "just types"], runs: [green, red("lint error at a.ts:1")] });
  assert.deepEqual(await runGate(deps), { ok: false, reason: 'the check "just lint" is red' });
  assert.match(messages[0] as string, /lint error at a\.ts:1/);
  assert.deepEqual(ran, [
    ["just", "test"],
    ["bash", "-c", "just lint"],
  ]);
});

test("all green: the gate passes and sends nothing", async () => {
  const { deps, messages, ran } = setup({ checks: ["just lint"] });
  assert.deepEqual(await runGate(deps), { ok: true, reason: "tests and checks green" });
  assert.deepEqual(messages, []);
  assert.equal(ran.length, 2);
});
