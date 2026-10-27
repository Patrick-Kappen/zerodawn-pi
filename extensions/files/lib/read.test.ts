import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileLines, linesInContext, seenRanges, segments } from "./lines.ts";
import { outline } from "./outline.ts";
import { READ_MAX_BYTES, READ_MAX_LINES, registerRead, renderRead } from "./read.ts";

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);
const wide = (n: number) => numbered(n).map((l) => `${l} ${"-".repeat(30)}`);
const none = new Set<number>();

test("a small file without a range is sent in full", () => {
  assert.deepEqual(renderRead("a.txt", numbered(3), undefined, undefined, none), { text: "line 1\nline 2\nline 3", shown: [[1, 3]] });
});

test("a big file without a range gives an outline, not the content", () => {
  const lines = numbered(300);
  lines[9] = "## Setup";
  lines[199] = "## Use";
  const r = renderRead("doc.md", lines, undefined, undefined, none);
  assert.match(r.text, /^doc\.md: 300 lines\. Outline \(line: text\):\n10: ## Setup\n200: ## Use\n/);
  assert.deepEqual(r.shown, []);
});

test("a big file with no outline rule gives the first window and the next offset", () => {
  const r = renderRead("x.log", numbered(300), undefined, undefined, none);
  assert.deepEqual(r.shown, [[1, READ_MAX_LINES]]);
  assert.match(r.text, /\[Showing lines 1-200 of 300\. Use offset=201 to continue\.\]$/);
});

test("limit is capped, and the note says so", () => {
  const r = renderRead("x.log", numbered(900), 1, 2000, none);
  assert.deepEqual(r.shown, [[1, 200]]);
  assert.match(r.text, /limit is capped at 200\. Use offset=201/);
});

test("a negative offset gives the last lines", () => {
  assert.equal(renderRead("x.log", numbered(50), -2, undefined, none).text, "line 49\nline 50");
});

test("an offset past the end fails with the line count", () => {
  assert.throws(() => renderRead("x.log", numbered(5), 9, undefined, none), /offset 9 is beyond the end of x\.log \(5 lines\)/);
});

test("lines already in context are not sent again; only the rest is shown", () => {
  const r = renderRead("x.ts", wide(20), 1, 20, new Set([1, 2, 3, 4, 5]));
  assert.deepEqual(r.shown, [[6, 20]]);
  assert.match(r.text, /^\[Lines 1-5 are unchanged and already in your context; not sent again\.\]\n\[lines 6-20\]\nline 6 -+\n/);
});

test("a known part shorter than the note is sent again; one known line is named as a line", () => {
  assert.deepEqual(renderRead("x.ts", numbered(20), 1, 20, new Set([1, 2])).shown, [[1, 20]]);
  const lines = [...numbered(3), "x".repeat(120), ...numbered(3)];
  const r = renderRead("x.ts", lines, 1, 7, new Set([4]));
  assert.deepEqual(r.shown, [
    [1, 3],
    [5, 7],
  ]);
  assert.match(r.text, /^\[Line 4 is unchanged and already in your context; not sent again\.\]\n/);
});

test("a range fully in context gives one line", () => {
  const r = renderRead("x.ts", wide(10), 2, 3, new Set([2, 3, 4]));
  assert.deepEqual(r, { text: "[x.ts lines 2-4 are unchanged and already in your context. Use that copy.]", shown: [] });
});

test("output is cut at the byte limit with the next offset", () => {
  const lines = Array.from({ length: 100 }, () => "x".repeat(1000));
  const r = renderRead("x.txt", lines, 1, 100, none);
  const shown = Math.floor(READ_MAX_BYTES / 1001);
  assert.deepEqual(r.shown, [[1, shown]]);
  assert.match(r.text, new RegExp(`Use offset=${shown + 1} to continue`));
});

test("linesInContext: same place, moved by an edit above, and changed lines", () => {
  const old = numbered(10);
  const ranges = seenRanges(old, [[3, 8]]);
  assert.deepEqual(
    [...linesInContext(old, ranges)].sort((a, b) => a - b),
    [3, 4, 5, 6, 7, 8],
  );
  const moved = ["new a", "new b", ...old];
  assert.deepEqual(
    [...linesInContext(moved, ranges)].sort((a, b) => a - b),
    [5, 6, 7, 8, 9, 10],
  );
  const changed = [...old];
  changed[5] = "edited";
  assert.deepEqual(
    [...linesInContext(changed, ranges)].sort((a, b) => a - b),
    [3, 4, 5],
  );
});

test("linesInContext: a run shorter than 3 lines does not count", () => {
  const ranges = seenRanges(["}", "a", "b", "c"], [[1, 4]]);
  assert.deepEqual([...linesInContext(["}", "x", "y", "z"], ranges)], []);
});

test("segments and fileLines", () => {
  assert.deepEqual(segments(1, 6, new Set([2, 3])), [
    [1, 1],
    [4, 6],
  ]);
  assert.deepEqual(fileLines("a\nb\n"), ["a", "b"]);
});

test("outline: ts declarations, and only top level when there are too many", () => {
  assert.deepEqual(outline("a.ts", ["import x from 'y';", "export function f() {", "  const a = 1;", "}", "class C {", "  run(x: number): void {"]).entries, [
    "2: export function f() {",
    "3:   const a = 1;",
    "5: class C {",
    "6:   run(x: number): void {",
  ]);
  const many = Array.from({ length: 400 }, (_, i) => (i % 2 ? "  const b = 1;" : "const a = 1;"));
  assert.equal(
    outline("a.ts", many).entries.every((e) => /: const a/.test(e)),
    true,
  );
  assert.deepEqual(outline("a.txt", ["# no"]).entries, []);
});

test("read tool: a second read of the same range is not sent again; after a change only new lines are sent", async () => {
  let tool: any;
  registerRead({ registerTool: (t: any) => (tool = t) } as any, "/");
  const dir = mkdtempSync(join(tmpdir(), "read-"));
  const file = join(dir, "a.ts");
  writeFileSync(file, `${wide(10).join("\n")}\n`);
  const entries: any[] = [];
  const ctx = { cwd: dir, sessionManager: { buildSessionProjection: () => ({ entries }) } } as any;
  const call = async (offset?: number, limit?: number) => {
    const r = await tool.execute("id", { path: "a.ts", offset, limit }, undefined, undefined, ctx);
    const message = { role: "toolResult", content: r.content, details: r.details };
    entries.push({ sourceEntry: { type: "message", message }, messages: [{ ...message }] });
    return r.content[0].text as string;
  };
  assert.match(await call(1, 5), /^line 1 -+\n[\s\S]*line 5 -+\n\n\[Showing lines 1-5 of 10\. Use offset=6 to continue\.\]$/);
  assert.match(await call(1, 5), /already in your context/);
  assert.match(await call(1, 8), /^\[Lines 1-5 are unchanged.*\n\[lines 6-8\]\nline 6 -+\nline 7 -+\nline 8 -+\n/);
  entries[0].messages[0].content = [{ type: "text", text: "[pruned]" }];
  entries[2].messages = [];
  assert.match(await call(1, 5), /^line 1 -+\n/);
});
