import assert from "node:assert/strict";
import { test } from "node:test";
import { conflict, formatDiagnostics, noEnv, noResult, noServer } from "./format.ts";

test("formatDiagnostics: one line per error, with file, line, column and source", () => {
  const text = formatDiagnostics("/w/a.ts", [
    { lnum: 3, col: 5, source: "ts", message: "Cannot find name 'x'." },
    { lnum: 7, col: 1, source: null, message: "second" },
  ]);
  assert.equal(text, "LSP errors after the edit of /w/a.ts:\n/w/a.ts:3:5 ts: Cannot find name 'x'.\n/w/a.ts:7:1 second");
});

test("the other messages", () => {
  assert.equal(conflict("/w/a.ts"), "/w/a.ts has unsaved changes in nvim; LSP check skipped");
  assert.equal(noResult("/w/a.ts"), "LSP gave no result for /w/a.ts in 15 s");
  assert.match(noServer("/run/nvim.sock"), /^nvim server \/run\/nvim\.sock is missing and did not appear within 5 s/);
  assert.match(noEnv, /PI_NVIM_SERVER is not set; LSP checks are off\./);
});
