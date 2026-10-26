import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { callOutFile, shorten } from "../../../shared/store.ts";
import { absolutePath } from "../../../shared/util.ts";
import { loadRecipes, type Recipes } from "./recipes.ts";
import { counts, failures, warningCount, warnings } from "./report.ts";
import { isCode, parseStatus, type Read, selectTests } from "./select.ts";

const TIMEOUT_MS = 10 * 60 * 1000;
const INLINE_MS = 15 * 1000;
const CHANGED_RECIPE = "test-changed";
const ALL_RECIPE = "test";
const RERUN = "# rerun";
const OTHER_RUNNER = /"(vitest|jest|mocha|ava)"/;
const NO_TEST =
  /(\.(md|mdx|txt|rst|adoc|png|jpe?g|gif|svg|ico|webp)$|(^|\/)(LICENSE|COPYING|NOTICE|AUTHORS)[^/]*$|(^|\/)\.(gitignore|gitattributes|editorconfig)$)/i;
const JS_CONFIG = /(^|\/)(package\.json|tsconfig[^/]*\.json|bunfig\.toml|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

const RECIPE_HOW = [
  `Add a recipe "${CHANGED_RECIPE} *files" to the justfile (Makefile: a target "${CHANGED_RECIPE}" that reads FILES).`,
  "run_tests gives it every changed path, also deleted files and files that are not code.",
  "It must run the tests for these files, fail when a changed code file has no test, and fail on a warning.",
  "Write it for the test tools of the project, as its AGENTS.md or README describes them.",
].join(" ");

export type Plan = { run: string[]; tests: string[]; uncovered: string[] } | { nothing: string } | { uncoveredOnly: string[] };

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    throw new Error(`run_tests: "git ${args.join(" ")}" failed in ${cwd}. run_tests finds the changed files with git; run it in a git repository.`, {
      cause: err,
    });
  }
}

/** True in a git work tree; false outside one. Throws when git is missing. */
export function inGit(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`run_tests: cannot run git in ${cwd}: ${r.error.message}. Install git.`, { cause: r.error });
  return r.status === 0;
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

/** Changed JavaScript and TypeScript files without a test; empty without a package.json. */
function uncoveredOf(cwd: string, changed: string[]): { tests: string[]; uncovered: string[] } {
  if (reader(cwd)("package.json") === undefined) return { tests: [], uncovered: [] };
  const files = git(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean);
  return selectTests(changed, files, reader(cwd));
}

export function plan(cwd: string, recipes: Recipes | undefined, scope: "changed" | "all", changed: string[]): Plan {
  const has = (name: string) => recipes?.list.some((r) => r.name === name);
  const pkg = reader(cwd)("package.json");
  const runner = pkg?.match(OTHER_RUNNER)?.[1];
  if (scope === "all") {
    if (recipes && has(ALL_RECIPE)) return { run: [recipes.tool, ALL_RECIPE], tests: [], uncovered: [] };
    if (pkg !== undefined && !runner) return { run: ["bun", "test", "--only-failures"], tests: [], uncovered: [] };
    throw new Error(
      `run_tests: no way to run every test in ${cwd}: no recipe "${ALL_RECIPE}" and no package.json for bun. Add a recipe "${ALL_RECIPE}" that runs every test of the project and fails on a warning.`,
    );
  }
  if (!changed.length) return { nothing: `No file changed in ${cwd} since the last commit. Set scope "all" to run every test.` };
  if (changed.every((f) => NO_TEST.test(f))) return { nothing: `Only files that need no test changed (${changed.join(", ")}).` };
  if (recipes && has(CHANGED_RECIPE)) {
    const run = recipes.tool === "just" ? ["just", CHANGED_RECIPE, ...changed] : ["make", CHANGED_RECIPE, `FILES=${changed.join(" ")}`];
    return { run, tests: [], uncovered: uncoveredOf(cwd, changed).uncovered };
  }
  if (pkg === undefined) throw new Error(`run_tests: no way to run the tests in ${cwd}: no recipe "${CHANGED_RECIPE}" and no package.json. ${RECIPE_HOW}`);
  if (runner) throw new Error(`run_tests: ${join(cwd, "package.json")} uses ${runner}, and run_tests runs only bun without a recipe. ${RECIPE_HOW}`);
  const other = changed.filter((f) => !isCode(f) && !NO_TEST.test(f) && !JS_CONFIG.test(f));
  if (other.length)
    throw new Error(
      `run_tests: without a recipe, run_tests tests only JavaScript and TypeScript, and these changed files are not: ${other.join(", ")}. ${RECIPE_HOW}`,
    );
  const { tests, uncovered } = uncoveredOf(cwd, changed);
  if (changed.some((f) => JS_CONFIG.test(f))) return { run: ["bun", "test", "--only-failures"], tests: [], uncovered };
  if (!tests.length) return { uncoveredOnly: uncovered };
  return { run: ["bun", "test", "--only-failures", ...tests.map((t) => `./${t}`)], tests, uncovered };
}

type Run = { output: string; code: number | null; timedOut: boolean; ms: number };

/** Runs argv in its own process group, so a time-out or a stop ends its children too. */
export function execute(argv: string[], cwd: string, signal: AbortSignal | undefined): Promise<Run> {
  const start = Date.now();
  const shown = argv[0] === "bash" ? argv[2] : argv.join(" ");
  if (signal?.aborted) return Promise.reject(new Error(`run_tests: "${shown}" was stopped by the user before it started.`));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
    let timedOut = false;
    let stopped = false;
    const killGroup = () => {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, TIMEOUT_MS);
    const abort = () => {
      stopped = true;
      killGroup();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (err.code === "ENOENT")
        reject(new Error(`run_tests: "${argv[0]}" is not installed or not in PATH. Install it, or add it to the dev shell.`, { cause: err }));
      else reject(new Error(`run_tests: cannot start "${shown}" in ${cwd}: ${err.message}`, { cause: err }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (stopped) reject(new Error(`run_tests: "${shown}" was stopped by the user.`));
      else resolve({ output: Buffer.concat(chunks).toString("utf8"), code, timedOut, ms: Date.now() - start });
    });
  });
}

type Result = { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError: boolean };

const noTest = (uncovered: string[]) =>
  `No test for: ${uncovered.join(", ")}. Add a test file that imports each of them, at the place and in the form that the AGENTS.md or README of the project gives, then run run_tests again.`;

/** One line for green; the failures or the warnings for red; the full output in the log. A warning makes a run red. */
function report(run: Run, shown: string, uncovered: string[], log: string): { text: string; ok: boolean } {
  const warned = warningCount(run.output);
  const failed = run.code !== 0 || run.timedOut;
  const ok = !failed && !warned && !uncovered.length;
  const status = run.timedOut ? `stopped after ${TIMEOUT_MS / 60000} min` : (counts(run.output) ?? `exit ${run.code}`);
  const extra = [warned ? `${warned} warning lines` : "", uncovered.length ? `${uncovered.length} changed files without a test` : ""].filter(Boolean);
  const lines = [`${ok ? "green" : "red"}: ${[status, ...extra, `${(run.ms / 1000).toFixed(1)} s`].join(" · ")}`, `command: ${shown}`];
  if (uncovered.length) lines.push(noTest(uncovered));
  if (failed) lines.push("", failures(run.output), "");
  else if (warned) lines.push("A warning is an error here: fix each one.", "", warnings(run.output), "");
  lines.push(`log: ${shorten(log)}`);
  return { text: lines.join("\n"), ok };
}

function fingerprint(cwd: string, what: string, changed: string[]): string {
  const read = reader(cwd);
  return JSON.stringify([cwd, what, changed.map((p) => [p, read(p) ?? null])]);
}

export const TOOL = {
  name: "run_tests",
  label: "run_tests",
  description: [
    "Run the tests for the files that changed since the last commit, or all tests.",
    `The project recipe "${CHANGED_RECIPE} *files" picks the tests when it exists. Else, for a package.json project, run_tests runs with bun every test file that imports a changed file.`,
    "A changed code file that no test file imports is an error. A warning is an error.",
    "The result is one line when the tests pass. When they fail, it shows only the failures. The full output goes to a log file.",
  ].join(" "),
  promptSnippet: "Run the tests for the changed files; green in one line, or only the failures",
  promptGuidelines: [
    "Run tests only with run_tests. A test command in bash runs run_tests in its place.",
    "A check command in bash (lint, types, just check) gives a short result. A warning is an error: fix it.",
    `A run longer than ${INLINE_MS / 1000} s continues in the background. Continue with other work; a message reports the result.`,
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

const LATER = "Continue with other work. A message gives the result. It is not a bash job: jobs wait does not see it.";
const TEST_HEAD = "Test commands in bash run through run_tests. Use run_tests next time. Result:";
const CHECK_HEAD = "Check commands in bash give a short result. Do not run the same check in another form. Result:";

/** The text and the state of a bash call that a test or check run replaced. */
export type Replacement = { text: string; isError: boolean };

/** Gives the result of a run that went to the background, as a message to the agent. */
export type Notify = (text: string, ok: boolean) => void;

const text = (t: string, isError: boolean, details: Record<string, unknown> = {}): Result => ({ content: [{ type: "text", text: t }], details, isError });

/**
 * The run_tests tool without its schema, and the check commands. Keeps the last results to give them again when no file changed.
 * A run waits up to inlineMs for its result; after that it continues in the background, and notify gives its result.
 */
export class RunTests {
  private last = new Map<string, Result>();
  private running = new Map<string, Promise<Result>>();
  private session = new AbortController();

  constructor(
    private readonly notify: Notify,
    private readonly inlineMs = INLINE_MS,
  ) {}

  /** Forgets the results and stops the background runs, for a new session. */
  reset() {
    this.last.clear();
    this.running.clear();
    this.session.abort();
    this.session = new AbortController();
  }

  /** Runs the tests for the changed files in place of a test command in bash, in the directory of its leading cd. */
  async insteadOfBash(toolCallId: string, command: string, ctx: ExtensionContext): Promise<Replacement> {
    try {
      const r = await this.execute(toolCallId, { path: cdOf(command), rerun: command.includes(RERUN) }, ctx.signal, ctx);
      return { text: `${TEST_HEAD}\n${r.content[0].text}`, isError: r.isError };
    } catch (err) {
      return { text: `${TEST_HEAD}\n${(err as Error).message}`, isError: true };
    }
  }

  /** Runs a check command such as "just check" in place of bash, with the same short result as the tests. */
  async check(toolCallId: string, command: string, ctx: ExtensionContext): Promise<Replacement> {
    try {
      const dir = absolutePath(cdOf(command) ?? ".", ctx.cwd);
      const clean = command.replace(RERUN, "").trim();
      const key = inGit(dir) ? fingerprint(dir, `check ${clean}`, changedFiles(dir)) : `check ${dir} ${clean}`;
      const earlier = this.last.get(key);
      if (earlier && !command.includes(RERUN))
        return { text: `${CHECK_HEAD}\n${again(earlier, `add "${RERUN}" to run it again`).content[0].text}`, isError: earlier.isError };
      const r = await this.inline(key, `check "${clean}"`, ctx.signal, async (signal) => {
        const run = await execute(["bash", "-c", command], ctx.cwd, signal);
        const log = callOutFile(ctx, toolCallId, "check");
        writeFileSync(log, run.output);
        const { text: t, ok } = report(run, command, [], log);
        return text(t, !ok, { log });
      });
      return { text: `${CHECK_HEAD}\n${r.content[0].text}`, isError: r.isError };
    } catch (err) {
      return { text: `${CHECK_HEAD}\n${(err as Error).message}`, isError: true };
    }
  }

  /** Starts a run and waits up to inlineMs for it. A later result goes to notify. A second call for the same key does not start a second run. */
  private async inline(key: string, label: string, signal: AbortSignal | undefined, start: (signal: AbortSignal) => Promise<Result>): Promise<Result> {
    if (this.running.has(key)) return text(`${label} still runs for this change. ${LATER}`, false, { background: true });
    const stop = new AbortController();
    const session = this.session.signal;
    const stopRun = () => stop.abort();
    session.addEventListener("abort", stopRun, { once: true });
    signal?.addEventListener("abort", stopRun, { once: true });
    const run = start(stop.signal)
      .then((r) => {
        if (!session.aborted) this.last.set(key, r);
        return r;
      })
      .finally(() => {
        session.removeEventListener("abort", stopRun);
        if (this.running.get(key) === run) this.running.delete(key);
      });
    this.running.set(key, run);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), this.inlineMs);
    });
    const first = await Promise.race([run, late]).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stopRun);
    });
    if (first) return first;
    run.then(
      (r) => this.notify(`${label}: ${r.content[0].text}`, !r.isError),
      (err: Error) => {
        if (!session.aborted) this.notify(`${label} failed: ${err.message}`, false);
      },
    );
    return text(`${label} runs in the background (more than ${this.inlineMs / 1000} s). ${LATER}`, false, { background: true });
  }

  async execute(toolCallId: string, params: Params, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<Result> {
    const scope = params.scope ?? "changed";
    const cwd = params.path ? absolutePath(params.path, ctx.cwd) : ctx.cwd;
    const changed = changedFiles(cwd);
    const key = fingerprint(cwd, scope, changed);
    const earlier = this.last.get(key);
    if (earlier && !params.rerun) return again(earlier, "set rerun only for a flaky test");

    const p = plan(cwd, loadRecipes(cwd), scope, changed);
    if ("nothing" in p || "uncoveredOnly" in p) {
      const result =
        "nothing" in p
          ? text(p.nothing, false, { changed })
          : text(`red: ${p.uncoveredOnly.length} changed files without a test\n${noTest(p.uncoveredOnly)}`, true, { changed, uncovered: p.uncoveredOnly });
      this.last.set(key, result);
      return result;
    }
    return this.inline(key, `run_tests "${p.run.join(" ")}"`, signal, async (stop) => {
      const run = await execute(p.run, cwd, stop);
      const log = callOutFile(ctx, toolCallId, "tests");
      writeFileSync(log, run.output);
      const { text: t, ok } = report(run, p.run.join(" "), p.uncovered, log);
      return text(t, !ok, { changed, tests: p.tests, uncovered: p.uncovered, log });
    });
  }
}

function again(result: Result, how: string): Result {
  const [first, ...rest] = result.content[0].text.split("\n");
  const text = [`${first} · no file changed since the last run; same result (${how})`, ...rest].join("\n");
  return { ...result, content: [{ type: "text", text }] };
}
