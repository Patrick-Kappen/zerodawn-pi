import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnostics } from "./report.ts";

test("diagnostics: the cause of a missing command; not an echoed option such as --error-on-warnings", () => {
  const just = "biome check --error-on-warnings .\nsh: line 1: biome: command not found\nerror: recipe `lint` failed on line 21 with exit code 127";
  assert.equal(diagnostics(just), "sh: line 1: biome: command not found\nerror: recipe `lint` failed on line 21 with exit code 127");
});

test("diagnostics: no biome summary line", () => {
  const out =
    "b.ts:1:1 lint/style/useConst\n! This let declares a variable that is only assigned once.\n\u00d7 Some warnings were emitted while running checks.";
  assert.equal(diagnostics(out), "b.ts:1:1 lint/style/useConst\n! This let declares a variable that is only assigned once.");
});
