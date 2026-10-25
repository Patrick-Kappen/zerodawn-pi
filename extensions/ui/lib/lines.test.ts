import assert from "node:assert/strict";
import { test } from "node:test";
import { plainText, withLead } from "./lines.ts";
import { oneLine } from "./util.ts";

const SGR = "\x1b[31m";
const OSC = "\x1b]8;;https://x\x07";

test("plainText strips SGR colors and OSC links", () => {
  assert.equal(plainText(`${SGR}red\x1b[0m ${OSC}link`), "red link");
});

test("withLead puts the lead before the text and keeps a leading escape in place", () => {
  assert.equal(withLead("text", "│ "), " │ text");
  assert.equal(withLead(`${SGR} text`, "│ "), ` │${SGR} text`);
  assert.equal(withLead(`${OSC}${SGR}text`, "│ "), `${OSC} │ ${SGR}text`);
});

test("oneLine collapses whitespace and control characters", () => {
  assert.equal(oneLine("a\n\tb   c "), "a b c");
  assert.equal(oneLine(`${SGR}a\nb`, { ansi: true }), `${SGR}a b`);
  assert.equal(oneLine(`${SGR}a\nb`), "[31ma b");
});
