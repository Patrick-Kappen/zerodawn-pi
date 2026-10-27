import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { diagnose, failures, warningLines } from "./report.ts";

test("diagnostics: the cause of a missing command; not an echoed option such as --error-on-warnings", () => {
  const just = "biome check --error-on-warnings .\nsh: line 1: biome: command not found\nerror: recipe `lint` failed on line 21 with exit code 127";
  assert.equal(diagnose(just).text, "sh: line 1: biome: command not found\nerror: recipe `lint` failed on line 21 with exit code 127");
});

test("diagnostics: no biome summary line", () => {
  const out =
    "b.ts:1:1 lint/style/useConst\n! This let declares a variable that is only assigned once.\n\u00d7 Some warnings were emitted while running checks.";
  assert.equal(diagnose(out).text, "b.ts:1:1: lint/style/useConst\n! This let declares a variable that is only assigned once.");
});

/** Golden test: each fixtures/check/<name>.log is a real check output; <name>.expected is the result the agent gets. A new finding is a new pair. */
test("diagnostics: each fixture gives its expected result", () => {
  const dir = new URL("./fixtures/check/", import.meta.url);
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log"));
  assert.ok(logs.length > 0, `no fixtures in ${dir.pathname}`);
  for (const f of logs) {
    const expected = readFileSync(new URL(f.replace(/\.log$/, ".expected"), dir), "utf8");
    assert.equal(`${diagnose(readFileSync(new URL(f, dir), "utf8")).text}\n`, expected, f);
  }
});

test("diagnose: fallback, cap and located show a result that the parser did not understand", () => {
  assert.deepEqual(diagnose("a\nb"), { text: "a\nb", fallback: true, capped: false, located: 0 });
  const many = Array.from({ length: 200 }, (_, i) => `f${i}.ts:1:1 error: x${i}`).join("\n");
  assert.deepEqual([diagnose(many).capped, diagnose(many).located], [true, 200]);
});

test("warningLines: not a name such as warningCount in printed source code", () => {
  assert.equal(warningLines("assert.equal(warningCount(lint), 1);\nwarning: real"), 1);
});

test("failures: no nix build progress or store path lists; the nix build log without its prefix", () => {
  const nix = "these 2 derivations will be built:\n  /nix/store/abc-a.drv\nbuilding '/nix/store/abc-a.drv'...\n       > (fail) a > b\n       > error: boom";
  assert.equal(failures(nix), "(fail) a > b\nerror: boom");
});

test("diagnose: a biome format error without a position names the file and the message", () => {
  const output = [
    "biome check --error-on-warnings .",
    "extensions/handoff/lib/lib.test.ts format ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "  × Formatter would have printed the following content:",
    "  ",
    "    176     │ - ··writeFileSync(file, x);",
    "        176 │ + ··writeFileSync(",
    "",
    "Checked 178 files in 22ms. No fixes applied.",
    "Found 1 error.",
    "check ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "  × Some errors were emitted while running checks.",
    "error: recipe `lint` failed on line 21 with exit code 1",
  ].join("\n");
  const d = diagnose(output);
  assert.equal(
    d.text,
    "extensions/handoff/lib/lib.test.ts: Formatter would have printed the following content:\nerror: recipe `lint` failed on line 21 with exit code 1",
  );
  assert.equal(d.located, 1);
});
