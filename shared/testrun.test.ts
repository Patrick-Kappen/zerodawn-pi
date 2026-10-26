import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { changedFiles, execute, plan, type Run, uncoveredOf, verdict } from "./testrun.ts";

const dir = mkdtempSync(join(tmpdir(), "shared-testrun-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const write = (path: string, text: string) => writeFileSync(join(dir, path), text);
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });

git("init", "-q");
write("package.json", "{}");
write("a.ts", "export const a = 1;\n");
write("a.test.ts", 'import { a } from "./a.ts";\nexport const t = a;\n');
git("add", ".");
git("commit", "-qm", "init");

const run = (over: Partial<Run>): Run => ({ output: "", code: 0, timedOut: false, ms: 1, ...over });

test("changedFiles and uncoveredOf: new code file without a test is uncovered", () => {
  assert.deepEqual(changedFiles(dir), []);
  write("b.ts", "export const b = 2;\n");
  write("README.md", "x");
  assert.deepEqual(changedFiles(dir).sort(), ["README.md", "b.ts"]);
  assert.deepEqual(uncoveredOf(dir, changedFiles(dir)).uncovered, ["b.ts"]);
});

test("plan with scope all: bun without a recipe; the recipe test when it exists; an error without both", () => {
  assert.deepEqual(plan(dir, undefined, "all", []), { run: ["bun", "test", "--only-failures"], tests: [], uncovered: [] });
  const recipes = { tool: "just" as const, file: join(dir, "justfile"), list: [{ name: "test" }] };
  assert.deepEqual(plan(dir, recipes, "all", []), { run: ["just", "test"], tests: [], uncovered: [] });
  const empty = mkdtempSync(join(tmpdir(), "shared-testrun-empty-"));
  try {
    assert.throws(() => plan(empty, undefined, "all", []), /no way to run every test/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("execute gives output and exit code", async () => {
  const r = await execute(["bash", "-c", "echo hi; exit 3"], dir, undefined);
  assert.equal(r.code, 3);
  assert.equal(r.output, "hi\n");
  await assert.rejects(execute(["no-such-command-xyz"], dir, undefined), /not installed/);
});

test("verdict: green, failed, timed out, and a warning is red", () => {
  assert.deepEqual(verdict(run({ output: "3 pass" })), { ok: true, text: "" });
  const failed = verdict(run({ code: 1, output: "(pass) a\n(fail) b\nerror: boom" }));
  assert.equal(failed.ok, false);
  assert.match(failed.text, /\(fail\) b/);
  assert.doesNotMatch(failed.text, /\(pass\)/);
  assert.match(verdict(run({ timedOut: true, code: null })).text, /stopped after 10 min/);
  const warned = verdict(run({ output: "ok\nwarn: old api" }));
  assert.equal(warned.ok, false);
  assert.match(warned.text, /1 warning lines.*warn: old api/s);
});

test("verdict: a warning gives only the diagnostics, once, without context or nix dirty-tree noise", () => {
  const output = "nix fmt\nwarning: Git tree '/w' is dirty\nsrc/a.ts:3:5 lint/x\n! warn here\nsrc/a.ts:3:5 lint/x\nFound 1 warning.\ntsc";
  assert.deepEqual(verdict(run({ output })), {
    ok: false,
    text: "2 warning lines. A warning is an error: fix each one.\nsrc/a.ts:3:5 lint/x (\u00d72)\n! warn here",
  });
});
