import assert from "node:assert/strict";
import { test } from "node:test";
import { counts, failures } from "./report.ts";

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
