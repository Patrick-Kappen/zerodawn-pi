import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { diagnose, diagnostics, failures, warningCount } from "./report.ts";

test("diagnostics: the cause of a missing command; not an echoed option such as --error-on-warnings", () => {
  const just = "biome check --error-on-warnings .\nsh: line 1: biome: command not found\nerror: recipe `lint` failed on line 21 with exit code 127";
  assert.equal(diagnostics(just), "sh: line 1: biome: command not found\nerror: recipe `lint` failed on line 21 with exit code 127");
});

test("diagnostics: no biome summary line", () => {
  const out =
    "b.ts:1:1 lint/style/useConst\n! This let declares a variable that is only assigned once.\n\u00d7 Some warnings were emitted while running checks.";
  assert.equal(diagnostics(out), "b.ts:1:1: lint/style/useConst\n! This let declares a variable that is only assigned once.");
});

/** Golden test: each fixtures/check/<name>.log is a real check output; <name>.expected is the result the agent gets. A new finding is a new pair. */
test("diagnostics: each fixture gives its expected result", () => {
  const dir = new URL("./fixtures/check/", import.meta.url);
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log"));
  assert.ok(logs.length > 0, `no fixtures in ${dir.pathname}`);
  for (const f of logs) {
    const expected = readFileSync(new URL(f.replace(/\.log$/, ".expected"), dir), "utf8");
    assert.equal(`${diagnostics(readFileSync(new URL(f, dir), "utf8"))}\n`, expected, f);
  }
});

test("diagnose: fallback, cap and located show a result that the parser did not understand", () => {
  assert.deepEqual(diagnose("a\nb"), { text: "a\nb", fallback: true, capped: false, located: 0 });
  const many = Array.from({ length: 200 }, (_, i) => `f${i}.ts:1:1 error: x${i}`).join("\n");
  assert.deepEqual([diagnose(many).capped, diagnose(many).located], [true, 200]);
});

test("warningCount: not a name such as warningCount in printed source code", () => {
  assert.equal(warningCount("assert.equal(warningCount(lint), 1);\nwarning: real"), 1);
});

test("failures: no nix build progress or store path lists; the nix build log without its prefix", () => {
  const nix = "these 2 derivations will be built:\n  /nix/store/abc-a.drv\nbuilding '/nix/store/abc-a.drv'...\n       > (fail) a > b\n       > error: boom";
  assert.equal(failures(nix), "(fail) a > b\nerror: boom");
});
