import { test } from "node:test";
import assert from "node:assert/strict";
import { explain, fixIndent, freshLines, nearest } from "./editfix.ts";

const file = ["switch (x) {", "\t\t\tcase \"rm\":", "\t\t\t\tdel();", "\t\t\t\tbreak;", "}"].join("\n");

test("fixIndent: one tab too few on all lines is fixed, newText too", () => {
  const f = fixIndent(file, "\t\tcase \"rm\":\n\t\t\tdel();", "\t\tcase \"rm\":\n\t\t\tdel2();")!;
  assert.equal(f.oldText, "\t\t\tcase \"rm\":\n\t\t\t\tdel();");
  assert.equal(f.newText, "\t\t\tcase \"rm\":\n\t\t\t\tdel2();");
});

test("fixIndent: the case of 2026-10-19 (only the last line one tab off) is not consistent, so no fix", () => {
  assert.equal(fixIndent(file, "\t\t\tcase \"rm\":\n\t\t\t\tdel();\n\t\t\tbreak;", "x"), undefined);
});

test("fixIndent: two places with the same lines is not fixed", () => {
  const twice = "\tfoo();\n\tbar();\n\tfoo();\n\tbar();";
  assert.equal(fixIndent(twice, "foo();\nbar();", "baz();"), undefined);
});

test("fixIndent: text that differs is not fixed", () => {
  assert.equal(fixIndent(file, "\t\tcase \"rmdir\":", "x"), undefined);
});

test("nearest: finds the similar lines with line numbers", () => {
  const n = nearest(file, "\t\t\tcase \"rm\":\n\t\t\t\tdel();\n\t\t\tbreak;")!;
  assert.equal(n.from, 2);
  assert.equal(n.to, 4);
  assert.ok(n.score > 0.9);
  assert.match(n.region, /^2\| \t\t\tcase "rm":\n3\| \t\t\t\tdel\(\);\n4\| \t\t\t\tbreak;$/);
});

test("explain: an insert written as oldText gets the insert hint", () => {
  assert.match(explain(file, "\ttar: [\"-C\"],", "\ttar: [\"-C\"],"), /To insert, use the line before or after/);
});

test("freshLines: the lines around each new text, numbered", () => {
  const text = ["a", "b", "c", "NEW", "d", "e", "f", "g"].join("\n");
  assert.equal(freshLines(text, ["NEW"], 1), 'Current lines (the "N| " prefix is not part of the file):\n3| c\n4| NEW\n5| d');
  assert.equal(freshLines(text, ["missing"]), undefined);
});

test("freshLines: a long new text shows its edges, and near ranges merge", () => {
  const body = Array.from({ length: 20 }, (_, i) => `n${i + 1}`);
  const text = ["a", ...body, "z"].join("\n");
  const out = freshLines(text, [body.join("\n")], 1)!;
  assert.equal(out.split("\n").slice(1).join("\n"), "1| a\n2| n1\n3| n2\n...\n20| n19\n21| n20\n22| z");
  assert.equal(freshLines("a\nb\nc\nd", ["b", "c"], 1)!.split("\n").slice(1).join("\n"), "1| a\n2| b\n3| c\n4| d");
});

test("explain: no similar text says to search", () => {
  assert.match(explain(file, "completely different words here", "y"), /Nothing in the file is like oldText/);
});
