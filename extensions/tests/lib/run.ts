import { execFileSync, spawn } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { callOutFile, shorten } from "../../../shared/store.ts";
import { absolutePath } from "../../../shared/util.ts";
import { loadRecipes, type Recipes } from "./recipes.ts";
import { counts, failures } from "./report.ts";
import { parseStatus, type Read, selectTests } from "./select.ts";

const TIMEOUT_MS = 10 * 60 * 1000;
const CHANGED_RECIPE = "test-changed";
const ALL_RECIPE = "test";
const OTHER_RUNNER = /"(vitest|jest|mocha|ava)"/;

export type Plan = { argv: string[]; tests: string[]; uncovered: string[] } | { nothing: string } | { uncoveredOnly: string[] };

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`run_tests: "git ${args.join(" ")}" failed in ${cwd}. run_tests finds the changed files with git; run it in a git repository.`, {
      cause: err,
    });
  }
}

/** Changed, new and deleted files under cwd, relative to cwd. */
export function changedFiles(cwd: string): string[] {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  return parseStatus(git(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]))
    .map((p) => relative(cwd, join(top, p)))
    .filter((p) => !p.startsWith(".."));
}

const reader =
  (cwd: string): Read =>
  (path) => {
    try {
      return statSync(join(cwd, path)).isFile() ? readFileSync(join(cwd, path), "utf8") : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(`run_tests: cannot read ${join(cwd, path)}: ${(err as Error).message}`, { cause: err });
    }
  };

function bunProject(cwd: string): boolean {
  const pkg = reader(cwd)("package.json");
  if (pkg === undefined) return false;
  if (OTHER_RUNNER.test(pkg))
    throw new Error(
      `run_tests: ${join(cwd, "package.json")} uses a test runner that run_tests does not know. Add a recipe "${CHANGED_RECIPE} *files" to the justfile.`,
    );
  return true;
}

const noWay = (cwd: string, recipe: string) =>
  new Error(
    `run_tests: no way to run the tests in ${cwd}: no recipe "${recipe}" and no package.json. Add a recipe "${recipe}" to the justfile or Makefile that runs the tests of the project, as its AGENTS.md or README describes them.`,
  );

export function plan(cwd: string, recipes: Recipes | undefined, scope: "changed" | "all", changed: string[]): Plan {
  const has = (name: string) => recipes?.list.some((r) => r.name === name);
  if (scope === "all") {
    if (recipes && has(ALL_RECIPE)) return { argv: [recipes.tool, ALL_RECIPE], tests: [], uncovered: [] };
    if (bunProject(cwd)) return { argv: ["bun", "test", "--only-failures"], tests: [], uncovered: [] };
    throw noWay(cwd, ALL_RECIPE);
  }
  if (!changed.length) return { nothing: `No file changed in ${cwd} since the last commit. Set scope "all" to run every test.` };
  if (recipes && has(CHANGED_RECIPE)) {
    const argv = recipes.tool === "just" ? ["just", CHANGED_RECIPE, ...changed] : ["make", CHANGED_RECIPE, `FILES=${changed.join(" ")}`];
    return { argv, tests: [], uncovered: [] };
  }
  if (!bunProject(cwd)) throw noWay(cwd, CHANGED_RECIPE);
  const files = git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  const { tests, uncovered } = selectTests(changed, files, reader(cwd));
  if (!tests.length && !uncovered.length) return { nothing: `No code file changed (${changed.join(", ")}). Set scope "all" to run every test.` };
  if (!tests.length) return { uncoveredOnly: uncovered };
  return { argv: ["bun", "test", "--only-failures", ...tests.map((t) => `./${t}`)], tests, uncovered };
}

type Run = { output: string; code: number | null; timedOut: boolean; ms: number };

function execute(argv: string[], cwd: string, signal: AbortSignal | undefined): Promise<Run> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.name === "AbortError") reject(new Error(`run_tests: "${argv.join(" ")}" was stopped by the user.`, { cause: err }));
      else if (err.code === "ENOENT")
        reject(new Error(`run_tests: "${argv[0]}" is not installed or not in PATH. Install it, or add it to the dev shell.`, { cause: err }));
      else reject(new Error(`run_tests: cannot start "${argv.join(" ")}" in ${cwd}: ${err.message}`, { cause: err }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output: Buffer.concat(chunks).toString("utf8"), code, timedOut, ms: Date.now() - start });
    });
  });
}

type Result = { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError: boolean };

const noTest = (uncovered: string[]) =>
  `No test for: ${uncovered.join(", ")}. Add a test file that imports each of them, at the place and in the form that the AGENTS.md or README of the project gives, then run run_tests again.`;

function fingerprint(cwd: string, scope: string, changed: string[]): string {
  const read = reader(cwd);
  return JSON.stringify([scope, changed.map((p) => [p, read(p) ?? null])]);
}

export const TOOL = {
  name: "run_tests",
  label: "run_tests",
  description: [
    "Run the tests for the files that changed since the last commit, or all tests.",
    `The project recipe "${CHANGED_RECIPE} *files" picks the tests when it exists. Else, for a package.json project, run_tests runs with bun every test file that imports a changed file.`,
    "A changed code file that no test file imports is an error.",
    "The result is one line when the tests pass. When they fail, it shows only the failures. The full output goes to a log file.",
  ].join(" "),
  promptSnippet: "Run the tests for the changed files; green in one line, or only the failures",
  promptGuidelines: [
    "Run tests only with run_tests. Test commands in bash are blocked.",
    "Add or change a test for each new behaviour or bug fix, then run run_tests.",
    "run_tests gives the earlier result when no file changed. Set rerun only for a flaky test.",
  ],
};

export type Params = { scope?: "changed" | "all"; rerun?: boolean; path?: string };

const LEADING_CD = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/;

/** The directory of a leading "cd <dir> &&" in a command, without quotes. */
export function cdOf(command: string): string | undefined {
  return command.match(LEADING_CD)?.[1].replace(/^["']|["']$/g, "");
}

/** The run_tests tool without its schema; keeps the last result to give it again when no file changed. */
export class RunTests {
  private last: { key: string; result: Result } | undefined;

  reset() {
    this.last = undefined;
  }

  /** Runs the tests for the changed files in place of a test command in bash, in the directory of its leading cd; the text is the reason of the block. */
  async insteadOfBash(toolCallId: string, command: string, ctx: ExtensionContext): Promise<string> {
    const head = "Test commands are blocked in bash. Use the run_tests tool. run_tests ran in place of your command:";
    try {
      return `${head}\n${(await this.execute(toolCallId, { path: cdOf(command) }, ctx.signal, ctx)).content[0].text}`;
    } catch (err) {
      return `${head}\n${(err as Error).message}`;
    }
  }

  async execute(toolCallId: string, params: Params, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<Result> {
    const scope = params.scope ?? "changed";
    const cwd = params.path ? absolutePath(params.path, ctx.cwd) : ctx.cwd;
    const changed = changedFiles(cwd);
    const key = fingerprint(cwd, scope, changed);
    if (this.last?.key === key && !params.rerun) {
      const [first, ...rest] = this.last.result.content[0].text.split("\n");
      const text = [`${first} · no file changed since the last run; same result`, ...rest].join("\n");
      return { ...this.last.result, content: [{ type: "text", text }] };
    }

    const p = plan(cwd, loadRecipes(cwd), scope, changed);
    let result: Result;
    if ("nothing" in p) result = { content: [{ type: "text", text: p.nothing }], details: { changed }, isError: false };
    else if ("uncoveredOnly" in p)
      result = {
        content: [{ type: "text", text: `red: ${p.uncoveredOnly.length} changed files without a test\n${noTest(p.uncoveredOnly)}` }],
        details: { changed, uncovered: p.uncoveredOnly },
        isError: true,
      };
    else {
      const run = await execute(p.argv, cwd, signal);
      const log = callOutFile(ctx, toolCallId, "tests");
      writeFileSync(log, run.output);
      const ok = run.code === 0 && !run.timedOut && !p.uncovered.length;
      const status = run.timedOut ? `stopped after ${TIMEOUT_MS / 60000} min` : (counts(run.output) ?? `exit ${run.code}`);
      const lines = [
        `${ok ? "green" : "red"}: ${status}${p.uncovered.length ? ` · ${p.uncovered.length} changed files without a test` : ""} · ${(run.ms / 1000).toFixed(1)} s`,
        `command: ${p.argv.join(" ")}`,
      ];
      if (p.uncovered.length) lines.push(noTest(p.uncovered));
      if (run.code !== 0 || run.timedOut) lines.push("", failures(run.output), "");
      lines.push(`log: ${shorten(log)}`);
      result = { content: [{ type: "text", text: lines.join("\n") }], details: { changed, tests: p.tests, uncovered: p.uncovered, log }, isError: !ok };
    }
    this.last = { key, result };
    return result;
  }
}
