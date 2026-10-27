import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Recipes } from "./recipes.ts";
import { diagnose, failures, warningLines } from "./report.ts";
import { isCode, parseStatus, type Read, selectTests } from "./select.ts";

export const TIMEOUT_MS = 10 * 60 * 1000;
export const CHANGED_RECIPE = "test-changed";
const ALL_RECIPE = "test";
const OTHER_RUNNER = /"(vitest|jest|mocha|ava)"/;
export const NO_TEST =
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

export const reader =
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
export function uncoveredOf(cwd: string, changed: string[]): { tests: string[]; uncovered: string[] } {
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

/** Runs argv in the dev environment of the project: through direnv when the git root of cwd has an .envrc. pi keeps the environment of the shell it started in, so another project needs its own. */
export function inProjectEnv(argv: string[], cwd: string): string[] {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  const root = r.status === 0 ? r.stdout.trim() : cwd;
  return existsSync(join(root, ".envrc")) ? ["direnv", "exec", root, ...argv] : argv;
}

export type Run = { output: string; code: number | null; timedOut: boolean; ms: number };

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

/** Red when the run failed, timed out, or has a warning line; text then gives the failures or the warnings, not the full output. */
export function verdict(run: Run): { ok: boolean; text: string } {
  const warned = warningLines(run.output);
  if (run.timedOut) return { ok: false, text: `stopped after ${TIMEOUT_MS / 60000} min\n${failures(run.output)}` };
  if (run.code !== 0) return { ok: false, text: failures(run.output) };
  if (warned) return { ok: false, text: `${warned} warning lines. A warning is an error: fix each one.\n${diagnose(run.output).text}` };
  return { ok: true, text: "" };
}
