import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Recipes } from "./recipes.ts";
import { cdOf, changedFiles, plan, RunTests } from "./run.ts";

const dir = mkdtempSync(join(tmpdir(), "run-tests-"));
const session = mkdtempSync(join(tmpdir(), "run-tests-session-"));
after(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(session, { recursive: true, force: true });
});
const write = (path: string, text: string) => writeFileSync(join(dir, path), text);
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });

git("init", "-q");
write("package.json", "{}");
write("a.ts", "export const a = 1;\n");
write("a.test.ts", 'import { test, expect } from "bun:test";\nimport { a } from "./a.ts";\ntest("a is 1", () => expect(a).toBe(1));\n');
git("add", ".");
git("commit", "-qm", "init");

const tool = new RunTests();
const ctx = { cwd: dir, sessionManager: { getSessionFile: () => join(session, "s.jsonl"), getBranch: () => [] } } as any;
const call = async (params: object) => {
  const r = await tool.execute("call-1", params, undefined, ctx);
  return { text: r.content[0].text as string, isError: r.isError as boolean };
};
const just = (names: string[]): Recipes => ({ tool: "just", file: join(dir, "justfile"), list: names.map((name) => ({ name })) });

test("no change: nothing to run", async () => {
  assert.deepEqual(changedFiles(dir), []);
  assert.match((await call({})).text, /No file changed in .* since the last commit/);
});

test("plan: a recipe test-changed gets the changed files; scope all uses the recipe test, else bun", () => {
  assert.deepEqual(plan(dir, just(["test-changed"]), "changed", ["a.ts"]), { argv: ["just", "test-changed", "a.ts"], tests: [], uncovered: [] });
  assert.deepEqual(plan(dir, just(["test"]), "all", []), { argv: ["just", "test"], tests: [], uncovered: [] });
  assert.deepEqual(plan(dir, undefined, "all", []), { argv: ["bun", "test", "--only-failures"], tests: [], uncovered: [] });
  assert.throws(() => plan(tmpdir(), undefined, "all", []), /no recipe "test" and no package.json/);
});

test("green: one line with the counts, the command and the log", async () => {
  write("a.ts", "export const a = 1; // changed\n");
  const r = await call({});
  assert.equal(r.isError, false);
  assert.match(r.text, /^green: 1 pass, 0 fail · [\d.]+ s\ncommand: bun test --only-failures \.\/a\.test\.ts\nlog: .*\.tests\.log$/);
  const again = await call({});
  assert.match(again.text, /^green: .* · no file changed since the last run; same result\n/);
});

test("cdOf: the directory of a leading cd", () => {
  assert.equal(cdOf("cd ~/w/x && bun test"), "~/w/x");
  assert.equal(cdOf('cd "/a b"; pytest'), "/a b");
  assert.equal(cdOf("bun test && cd x"), undefined);
});

test("in place of a bash test command: the result after the reason of the block, in the directory of its cd", async () => {
  assert.match(
    await new RunTests().insteadOfBash("call-2", `cd ${dir} && bun test`, { ...ctx, cwd: tmpdir() }),
    /^Test commands are blocked in bash\. Use the run_tests tool\. run_tests ran in place of your command:\ngreen: 1 pass, 0 fail · /,
  );
});

test("red: only the failure; a new file without a test", async () => {
  write("a.ts", "export const a = 2;\n");
  write("b.ts", "export const b = 1;\n");
  const r = await call({});
  assert.equal(r.isError, true);
  assert.match(r.text, /^red: 0 pass, 1 fail · 1 changed files without a test · /);
  assert.match(r.text, /No test for: b\.ts\./);
  assert.match(r.text, /\(fail\) a is 1/);
  assert.doesNotMatch(r.text, /bun test v/);
});

test("red without a run: only files without a test changed", async () => {
  write("a.ts", "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "b");
  write("b.ts", "export const b = 2;\n");
  const r = await call({});
  assert.equal(r.isError, true);
  assert.equal(
    r.text,
    "red: 1 changed files without a test\nNo test for: b.ts. Add a test file that imports each of them, at the place and in the form that the AGENTS.md or README of the project gives, then run run_tests again.",
  );
});
