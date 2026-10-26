import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Recipes } from "./recipes.ts";
import { cdOf, changedFiles, execute, plan, RunTests } from "./run.ts";

const temp = (name: string) => mkdtempSync(join(tmpdir(), `run-tests-${name}-`));
const dir = temp("repo");
const session = temp("session");
const plain = temp("plain");
const vitest = temp("vitest");
after(() => {
  for (const d of [dir, session, plain, vitest]) rmSync(d, { recursive: true, force: true });
});
const write = (path: string, text: string) => writeFileSync(join(dir, path), text);
const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
writeFileSync(join(vitest, "package.json"), '{"devDependencies":{"vitest":"1"}}');

const TEST_A = 'import { test, expect } from "bun:test";\nimport { a } from "./a.ts";\ntest("a is 1", () => expect(a).toBe(1));\n';
git("init", "-q");
write("package.json", "{}");
write("a.ts", "export const a = 1;\n");
write("a.test.ts", TEST_A);
git("add", ".");
git("commit", "-qm", "init");

const notes: { text: string; ok: boolean }[] = [];
const notify = (text: string, ok: boolean) => notes.push({ text, ok });
const tool = new RunTests(notify);
const ctx = { cwd: dir, sessionManager: { getSessionFile: () => join(session, "s.jsonl"), getBranch: () => [] } } as any;
const call = async (params: object) => {
  const r = await tool.execute("call-1", params, undefined, ctx);
  return { text: r.content[0].text as string, isError: r.isError as boolean };
};
const recipes = (tool: "just" | "make", names: string[]): Recipes => ({ tool, file: join(dir, "justfile"), list: names.map((name) => ({ name })) });
const ALL = ["bun", "test", "--only-failures"];

test("no change: nothing to run", async () => {
  assert.deepEqual(changedFiles(dir), []);
  assert.match((await call({})).text, /No file changed in .* since the last commit/);
});

test("plan: the recipe test-changed gets every changed file; scope all uses the recipe test, else bun", () => {
  assert.deepEqual(plan(dir, recipes("just", ["test-changed"]), "changed", ["a.ts", "x.py"]), {
    run: ["just", "test-changed", "a.ts", "x.py"],
    tests: [],
    uncovered: [],
  });
  assert.deepEqual(plan(dir, recipes("make", ["test-changed"]), "changed", ["a.ts"]), {
    run: ["make", "test-changed", "FILES=a.ts"],
    tests: [],
    uncovered: [],
  });
  assert.deepEqual(plan(dir, recipes("just", ["test"]), "all", []), { run: ["just", "test"], tests: [], uncovered: [] });
  assert.deepEqual(plan(dir, undefined, "all", []), { run: ALL, tests: [], uncovered: [] });
  assert.throws(() => plan(plain, undefined, "all", []), /no recipe "test" and no package.json for bun/);
});

test("plan: without a recipe, a project that bun cannot test gets the contract of the recipe", () => {
  const contract =
    /Add a recipe "test-changed \*files".*every changed path, also deleted files.*fail when a changed code file has no test, and fail on a warning/;
  assert.throws(() => plan(plain, undefined, "changed", ["main.go"]), new RegExp(`no recipe "test-changed" and no package.json\\. ${contract.source}`));
  assert.throws(() => plan(vitest, undefined, "changed", ["a.ts"]), /uses vitest, and run_tests runs only bun without a recipe/);
  assert.throws(() => plan(dir, undefined, "changed", ["a.ts", "tool.py", "flake.nix"]), /these changed files are not: tool\.py, flake\.nix\. Add a recipe/);
});

test("plan: only files that need no test; a JS config file runs every test", () => {
  assert.deepEqual(plan(dir, undefined, "changed", ["README.md", "docs/x.png"]), { nothing: "Only files that need no test changed (README.md, docs/x.png)." });
  assert.deepEqual(plan(dir, undefined, "changed", ["tsconfig.json"]), { run: ALL, tests: [], uncovered: [] });
});

test("green: one line with the counts, the command and the log; the same result when no file changed", async () => {
  write("a.ts", "export const a = 1; // changed\n");
  const r = await call({});
  assert.equal(r.isError, false);
  assert.match(r.text, /^green: 1 pass, 0 fail · [\d.]+ s\ncommand: bun test --only-failures \.\/a\.test\.ts\nlog: .*\.tests\.log$/);
  assert.match((await call({})).text, /^green: .* · no file changed since the last run; same result \(set rerun only for a flaky test\)\n/);
});

test("a warning makes a run red and shows the warning", async () => {
  write("a.test.ts", `console.warn("warning: a is deprecated");\n${TEST_A}`);
  const r = await call({});
  assert.equal(r.isError, true);
  assert.match(r.text, /^red: 1 pass, 0 fail · 1 warning lines · /);
  assert.match(r.text, /A warning is an error here: fix each one\.\n\n(.*\n)*warning: a is deprecated/);
  write("a.test.ts", TEST_A);
});

test("cdOf: the directory of a leading cd", () => {
  assert.equal(cdOf("cd ~/w/x && bun test"), "~/w/x");
  assert.equal(cdOf('cd "/a b"; pytest'), "/a b");
  assert.equal(cdOf("bun test && cd x"), undefined);
});

test("in place of a bash test command: the run_tests result, in the directory of its cd", async () => {
  const r = await new RunTests(notify).insteadOfBash("call-2", `cd ${dir} && bun test`, { ...ctx, cwd: tmpdir() });
  assert.equal(r.isError, false);
  assert.match(r.text, /^Test commands in bash run through run_tests\. Use run_tests next time\. Result:\ngreen: 1 pass, 0 fail · /);
  const failed = await new RunTests(notify).insteadOfBash("call-2", "bun test", { ...ctx, cwd: tmpdir() });
  assert.equal(failed.isError, true);
  assert.match(failed.text, /\nrun_tests: "git rev-parse --show-toplevel" failed/);
});

test("a run longer than the inline time continues in the background; a message gives its result; a second call does not start it again", async () => {
  const slow = new RunTests(notify, 50);
  notes.length = 0;
  const command = `cd ${dir} && sleep 0.3; echo done`;
  const first = await slow.check("call-6", command, ctx);
  assert.deepEqual(first.isError, false);
  assert.match(first.text, /check "cd .* echo done" runs in the background \(more than 0\.05 s\)\. Continue with other work\. A message gives the result\./);
  assert.match((await slow.check("call-7", command, ctx)).text, /still runs for this change/);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].ok, true);
  assert.match(notes[0].text, /^check "cd .* echo done": green: exit 0 · /);
  assert.match((await slow.check("call-8", command, ctx)).text, /same result/);
});

test("reset stops a background run without a message", async () => {
  const slow = new RunTests(notify, 50);
  notes.length = 0;
  await slow.check("call-9", `cd ${dir} && sleep 5`, ctx);
  slow.reset();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(notes, []);
});

test("a check command runs in place: green, red on a failure, red on a warning, the same result until a change or # rerun", async () => {
  const checks = new RunTests(notify);
  const check = async (command: string) => (await checks.check("call-3", `cd ${dir} && ${command}`, ctx)).text;
  assert.match(
    await check("echo ok"),
    /^Check commands in bash give a short result\. .*\ngreen: exit 0 · [\d.]+ s\ncommand: cd .* && echo ok\nlog: .*\.check\.log$/,
  );
  assert.equal((await checks.check("call-5", `cd ${dir} && exit 1`, ctx)).isError, true);
  assert.match(await check("echo boom; exit 3"), /\nred: exit 3 · [\d.]+ s\ncommand: .*\n\nboom\n/);
  assert.match(await check("echo 'warning: unused x'"), /\nred: exit 0 · 1 warning lines · (.*\n)*warning: unused x/);
  assert.match(await check("echo ok"), /green: exit 0 · .* · no file changed since the last run; same result \(add "# rerun" to run it again\)/);
  assert.doesNotMatch(await check("echo ok # rerun"), /same result/);
  assert.match((await checks.check("call-4", `cd ${plain} && echo outside`, ctx)).text, /green: exit 0/);
});

test("a stop by the user ends the command and its children at once", async () => {
  const stop = new AbortController();
  const start = Date.now();
  const run = execute(["bash", "-c", "sleep 5 & sleep 5; wait"], dir, stop.signal);
  setTimeout(() => stop.abort(), 100);
  await assert.rejects(run, /"sleep 5 & sleep 5; wait" was stopped by the user\./);
  assert.ok(Date.now() - start < 2000);
});

test("a missing runner names the program", async () => {
  await assert.rejects(execute(["no-such-runner-x"], dir, undefined), /"no-such-runner-x" is not installed or not in PATH/);
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
  assert.match(r.text, /^red: 1 changed files without a test\nNo test for: b\.ts\. Add a test file that imports each of them/);
});

test("the cache knows the directory: the same change in another worktree runs again", async () => {
  const other = temp("worktree");
  after(() => rmSync(other, { recursive: true, force: true }));
  execFileSync("git", ["clone", "-q", dir, other]);
  writeFileSync(join(other, "b.ts"), "export const b = 2;\n");
  const r = await tool.execute("call-5", { path: other }, undefined, ctx);
  assert.doesNotMatch(r.content[0].text, /same result/);
});
