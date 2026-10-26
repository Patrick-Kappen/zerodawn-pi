import assert from "node:assert/strict";
import { test } from "node:test";
import { counts, diagnostics, failures, warningCount, warnings } from "./report.ts";

const bun = `bun test v1.4.2

a.test.ts:
✓ ok one [0.83ms]
(pass) ok two [0.1ms]
AssertionError: Expected values to be strictly equal:

2 !== 3



      at /tmp/bt/a.test.ts:4:32
      at run (node:async_hooks:144:29)
      at node:test:1445:26
✗ bad one [0.61ms]

 1 pass
 1 fail
Ran 2 tests across 1 file. [11.00ms]`;

test("counts: pass and fail of bun; undefined for other output", () => {
  assert.equal(counts(bun), "1 pass, 1 fail");
  assert.equal(counts("FAILED tests/x.py::y"), undefined);
});

test("failures: no passed tests, no runtime frames, no blank runs", () => {
  const out = failures(bun);
  assert.doesNotMatch(out, /✓|\(pass\)|bun test v|node:async_hooks|node:test/);
  assert.match(out, /2 !== 3\n\n {6}at \/tmp\/bt\/a.test.ts:4:32\n✗ bad one/);
});

test("failures: a long output keeps its start and end", () => {
  const out = failures(Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n")).split("\n");
  assert.equal(out.length, 151);
  assert.equal(out[0], "line 0");
  assert.match(out[110], /350 lines more in the log/);
  assert.equal(out.at(-1), "line 499");
});

const lint = `Checked 85 files in 12ms.
extensions/bash/tool/jobproc.test.ts:37:45 lint/suspicious/noTemplateCurlyInString
  ! Unexpected template string placeholder.
    37 | const r = await run('echo "\${PIPESTATUS[0]}"');

other output
Found 1 warning.
✓ a test about warnings
eslint: 0 warnings`;

test("warningCount: warning lines and biome '!' lines; not '0 warnings' and not passed test names", () => {
  assert.equal(warningCount(lint), 1);
  assert.equal(warningCount("all good\nFound 0 warnings"), 0);
  assert.equal(warningCount("biome check --error-on-warnings .\nnix flake check --option warn-dirty false"), 0);
  assert.equal(warningCount("DeprecationWarning: x\nWARN y"), 2);
});

test("diagnostics: location, warning and error lines once; no summary, context or passed test names", () => {
  assert.equal(
    diagnostics(lint),
    "extensions/bash/tool/jobproc.test.ts:37:45: lint/suspicious/noTemplateCurlyInString\n! Unexpected template string placeholder.",
  );
});

test("diagnostics: a repeated line once with its count; nix dirty-tree noise left out", () => {
  const nix =
    " 3 pass\n 0 fail\nnix fmt\nwarning: Git tree '/w' is dirty\nsrc/a.ts(3,5): error TS2322: x\nsrc/a.ts(3,5): error TS2322: x\nwarning: Git tree '/w' is dirty\ntsc";
  assert.equal(diagnostics(nix), "src/a.ts(3,5): error TS2322: x (×2)");
  assert.equal(warningCount(nix), 0);
});

test("diagnostics: the last 20 lines when no line has a location, warning or error", () => {
  const out = diagnostics(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")).split("\n");
  assert.deepEqual([out.length, out[0], out.at(-1)], [20, "line 30", "line 49"]);
});

test("warnings: each warning line with two lines before it and its block after it", () => {
  const out = warnings(lint);
  assert.match(out, /jobproc\.test\.ts:37:45 .*\n {2}! Unexpected template string placeholder\.\n.*PIPESTATUS/);
  assert.match(out, /Found 1 warning\./);
  assert.doesNotMatch(out, /a test about warnings/);
  assert.equal(warnings("a\nb\nc\nwarning: x\n  detail\n\nd"), "b\nc\nwarning: x\n  detail");
});
