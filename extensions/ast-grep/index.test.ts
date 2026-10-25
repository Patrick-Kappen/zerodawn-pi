import assert from "node:assert/strict";
import { test } from "node:test";
import { clip, format, type Match, plural } from "./lib/format.ts";

const match = (file: string, line: number, text: string, extra: Partial<Match> = {}): Match => ({
  file,
  text,
  lines: text,
  range: { start: { line }, end: { line } },
  ...extra,
});

test("plural adds s or es", () => {
  assert.equal(plural(1, "match"), "1 match");
  assert.equal(plural(2, "match"), "2 matches");
  assert.equal(plural(0, "file"), "0 files");
});

test("clip trims and cuts long lines", () => {
  assert.equal(clip("  short  "), "short");
  const long = "x".repeat(250);
  assert.equal(clip(long), `${"x".repeat(200)}…`);
});

test("format groups matches per file with line numbers, spans and rewrites", () => {
  const out = format([
    match("a.ts", 0, "console.log(1)"),
    match("b.ts", 4, "foo(\n  1,\n)", { lines: "foo(\n  1,\n)", range: { start: { line: 4 }, end: { line: 6 } } }),
    match("a.ts", 9, "console.log(2)", { replacement: "logger.info(2)" }),
  ]);
  assert.equal(out, ["a.ts", "  1: console.log(1)", "  10: console.log(2)", "  10→ logger.info(2)", "b.ts", "  5: foo( (+2 lines)"].join("\n"));
});
