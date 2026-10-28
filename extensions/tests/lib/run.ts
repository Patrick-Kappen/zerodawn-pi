import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { callFileId, callOutFile, outRef } from "../../../shared/store.ts";
import { CHANGED_RECIPE, changedFiles, execute, inGit, inProjectEnv, NO_TEST, plan, type Run, reader, TIMEOUT_MS } from "../../../shared/testrun.ts";
import { absolutePath } from "../../../shared/util.ts";
import { loadRecipes } from "./recipes.ts";
import { counts, type Diagnosis, diagnose, failures, warningLines } from "./report.ts";

type Result = { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError: boolean };

const noTest = (uncovered: string[]) =>
  `No test for: ${uncovered.join(", ")}. Add a test file that imports each of them, at the place and in the form that the AGENTS.md or README of the project gives, then run run_tests again.`;

/** The file in the session directory where noteAnomaly writes; extensions/bash/scripts/check-findings.ts reads it. */
export const ANOMALIES = "check-anomalies.jsonl";

/** Writes a red result that the parser did not understand: no line matched, the result was cut, or no diagnostic has a location. */
function noteAnomaly(d: Diagnosis, command: string, log: string): void {
  const signals = [d.fallback && "fallback", d.capped && "capped", !d.fallback && !d.located && "no location"].filter(Boolean);
  if (!signals.length) return;
  const line = JSON.stringify({ time: new Date().toISOString(), signals, command, log, result: d.text });
  appendFileSync(join(dirname(dirname(log)), ANOMALIES), `${line}\n`);
}

/** One line for green; for red the failures of a test run, or the diagnostics of a check or a warning; the full output in the log. A warning makes a run red. */
function report(run: Run, kind: "tests" | "check", command: string, uncovered: string[], log: string): { text: string; ok: boolean } {
  const warned = warningLines(run.output);
  const failed = run.code !== 0 || run.timedOut;
  const ok = !failed && !warned && !uncovered.length;
  const status = run.timedOut ? `stopped after ${TIMEOUT_MS / 60000} min` : (counts(run.output) ?? `exit ${run.code}`);
  const extra = [warned ? `${warned} warning lines` : "", uncovered.length ? `${uncovered.length} changed files without a test` : ""].filter(Boolean);
  const lines = [`${ok ? "green" : "red"}: ${[status, ...extra, `${(run.ms / 1000).toFixed(1)} s`].join(" · ")}`];
  if (ok) return { text: `${lines[0]} · log: ${outRef(log)}`, ok };
  if (uncovered.length) lines.push(noTest(uncovered));
  if (warned) lines.push("A warning is an error here: fix each one.");
  if (failed && kind === "tests") lines.push(failures(run.output));
  else if (failed || warned) {
    const d = diagnose(run.output);
    lines.push(d.text);
    noteAnomaly(d, command, log);
  }
  lines.push(`log: ${outRef(log)}`);
  return { text: lines.join("\n"), ok };
}

/** The short result of a test or check command that ran as one part of a bash chain; bash keeps the full output in a second log. */
export function partReport(kind: "tests" | "check", output: string, code: number): string {
  const warned = warningLines(output);
  const ok = code === 0 && !warned;
  const status = [counts(output) ?? `exit ${code}`, warned ? `${warned} warning lines` : ""].filter(Boolean).join(" · ");
  const lines = [`${kind} ${ok ? "green" : "red"}: ${status}`];
  if (ok) return lines[0];
  if (warned) lines.push("A warning is an error here: fix each one.");
  lines.push(code !== 0 && kind === "tests" ? failures(output) : diagnose(output).text);
  return lines.join("\n");
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
    "A test command in bash runs run_tests in its place, and a check command in bash (lint, types, just check) gives a short result.",
    "A run returns at once and continues in the background; a message gives the result. Continue with other work, or end your turn when the next step needs the result.",
    "The tests of each file also run after each edit or write; a message comes only when they fail.",
    "With no file changed since the last run, including the run after an edit, it runs nothing.",
  ].join(" "),
  promptSnippet: "Run the tests for the changed files; green in one line, or only the failures",
};

export type Params = { scope?: "changed" | "all"; path?: string };

const AFTER_EDIT =
  "No file changed since the tests ran after your last edit; run_tests runs nothing. A message comes only when those tests fail, so no message means green.";

const LEADING_CD = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/;

/** The directory of a leading "cd <dir> &&" in a command, without quotes. */
export function cdOf(command: string): string | undefined {
  return command.match(LEADING_CD)?.[1].replace(/^["']|["']$/g, "");
}

const LATER = "A message gives the result.";
const TEST_HEAD = "run_tests result (use run_tests next time):";
const CHECK_HEAD = "Check result (do not run it again in another form):";

/** The text and the state of a bash call that a test or check run replaced. */
export type Replacement = { text: string; isError: boolean; background?: boolean };

/** Gives the result of a run that went to the background, as a message to the agent. */
export type Notify = (text: string, ok: boolean) => void;

const text = (t: string, isError: boolean, details: Record<string, unknown> = {}): Result => ({ content: [{ type: "text", text: t }], details, isError });

/**
 * The run_tests tool without its schema, and the check commands. Keeps the last results to give them again when no file changed.
 * A run continues in the background, and notify gives its result. Only the tests pass an inlineMs, to read a result in the call.
 */
export class RunTests {
  private last = new Map<string, Result>();
  private running = new Map<string, Promise<Result>>();
  private session = new AbortController();
  /** Per git root: the state of the changed files when the tests last ran after an edit. */
  private edited = new Map<string, string>();
  /** The tail of the queue of runs after an edit, so they run one after another. */
  private queue: Promise<void> = Promise.resolve();
  /** Per edited file: the number of its last edit. */
  private edits = new Map<string, number>();
  /** The failures after an edit that notify gave; the same failure comes once. */
  private sent = new Set<string>();
  private pending = 0;

  constructor(
    private readonly notify: Notify,
    private readonly inlineMs = 0,
  ) {}

  /** Forgets the results and stops the background runs, for a new session. */
  reset() {
    this.last.clear();
    this.running.clear();
    this.edited.clear();
    this.queue = Promise.resolve();
    this.pending = 0;
    this.edits.clear();
    this.sent.clear();
    this.session.abort();
    this.session = new AbortController();
  }

  /** Ends when the next background run ends and its notify ran; undefined when none runs. */
  nextResult(): Promise<void> | undefined {
    if (this.running.size === 0) return undefined;
    return Promise.race([...this.running.values()]).then(
      () => {},
      () => {},
    );
  }

  /** Runs the tests for the changed files in place of a test command in bash, in the directory of its leading cd. */
  async insteadOfBash(toolCallId: string, command: string, ctx: ExtensionContext): Promise<Replacement> {
    try {
      const r = await this.execute(toolCallId, { path: cdOf(command) }, ctx.signal, ctx);
      return { text: `${TEST_HEAD}\n${r.content[0].text}`, isError: r.isError, background: r.details.background === true };
    } catch (err) {
      return { text: `${TEST_HEAD}\n${(err as Error).message}`, isError: true };
    }
  }

  /** Runs a check command such as "just check" in place of bash, with the same short result as the tests. */
  async check(toolCallId: string, command: string, ctx: ExtensionContext): Promise<Replacement> {
    try {
      const dir = absolutePath(cdOf(command) ?? ".", ctx.cwd);
      // Outside git no change shows, so the check always runs there.
      const key = inGit(dir) ? fingerprint(dir, `check ${command.trim()}`, changedFiles(dir)) : `check ${dir} ${command.trim()} ${Date.now()}`;
      const earlier = this.last.get(key);
      if (earlier) return { text: `${CHECK_HEAD}\n${again(earlier).content[0].text}`, isError: earlier.isError };
      const r = await this.inline(key, `check ${callFileId(ctx, toolCallId)}`, ctx.signal, async (signal) => {
        const run = await execute(inProjectEnv(["bash", "-o", "pipefail", "-c", command], dir), ctx.cwd, signal);
        const log = callOutFile(ctx, toolCallId, "check");
        writeFileSync(log, run.output);
        const { text: t, ok } = report(run, "check", command, [], log);
        return text(t, !ok, { log });
      });
      return { text: `${CHECK_HEAD}\n${r.content[0].text}`, isError: r.isError, background: r.details.background === true };
    } catch (err) {
      return { text: `${CHECK_HEAD}\n${(err as Error).message}`, isError: true };
    }
  }

  /** Starts a run in the background; its result goes to notify. A second call for the same key does not start a second run. */
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
    return text(`${label}: runs in the background. ${LATER}`, false, { background: true });
  }

  /**
   * Runs the tests of one edited file in the background, one run after the other.
   * A later edit of the same file replaces a run that did not start. notify gets only a red result,
   * only when the file did not change during the run, and the same failure only once.
   */
  afterEdit(toolCallId: string, path: string, ctx: ExtensionContext): Promise<void> {
    const file = absolutePath(path, ctx.cwd);
    const edit = (this.edits.get(file) ?? 0) + 1;
    this.edits.set(file, edit);
    const session = this.session.signal;
    const run = async () => {
      if (session.aborted || this.edits.get(file) !== edit) return;
      let result: { text: string; ok: boolean };
      let label = `tests after the edit of ${file}`;
      let unchanged = () => true;
      try {
        if (!inGit(dirname(file))) return;
        const root = gitRoot(dirname(file));
        const rel = relative(root, file);
        if (NO_TEST.test(rel)) return;
        label = `tests after the edit of ${rel}`;
        const before = fingerprint(root, "edit", [rel]);
        unchanged = () => fingerprint(root, "edit", [rel]) === before;
        this.edited.set(root, state(root));
        const p = plan(root, loadRecipes(root), "changed", [rel]);
        if ("nothing" in p) return;
        if ("uncoveredOnly" in p) result = { text: `red: ${rel} has no test\n${noTest(p.uncoveredOnly)}`, ok: false };
        else {
          const out = await execute(inProjectEnv(p.run, root), root, session);
          const log = callOutFile(ctx, toolCallId, "tests");
          writeFileSync(log, out.output);
          result = report(out, "tests", p.run.join(" "), p.uncovered, log);
        }
      } catch (err) {
        result = { text: `failed: ${(err as Error).message}`, ok: false };
      }
      if (session.aborted || result.ok || !unchanged()) return;
      const message = `${label}: ${result.text}`;
      if (this.sent.has(message)) return;
      this.sent.add(message);
      this.notify(message, false);
    };
    this.pending++;
    this.queue = this.queue.then(run).finally(() => {
      if (!session.aborted) this.pending--;
    });
    return this.queue;
  }

  /** Ends when the runs after an edit end; true when one of them gave a failure to notify. undefined when none runs. */
  editsDone(): Promise<boolean> | undefined {
    if (this.pending === 0) return undefined;
    const sent = this.sent.size;
    const session = this.session.signal;
    return this.queue.then(() => !session.aborted && this.sent.size > sent);
  }

  async execute(toolCallId: string, params: Params, signal: AbortSignal | undefined, ctx: ExtensionContext): Promise<Result> {
    const scope = params.scope ?? "changed";
    const cwd = params.path ? absolutePath(params.path, ctx.cwd) : ctx.cwd;
    const changed = changedFiles(cwd);
    const key = fingerprint(cwd, scope, changed);
    const earlier = this.last.get(key);
    if (earlier) return again(earlier);
    if (scope === "changed" && this.edited.has(gitRoot(cwd)) && this.edited.get(gitRoot(cwd)) === state(gitRoot(cwd)))
      return text(AFTER_EDIT, false, { changed });

    const p = plan(cwd, loadRecipes(cwd), scope, changed);
    if ("nothing" in p || "uncoveredOnly" in p) {
      const result =
        "nothing" in p
          ? text(p.nothing, false, { changed })
          : text(`red: ${p.uncoveredOnly.length} changed files without a test\n${noTest(p.uncoveredOnly)}`, true, { changed, uncovered: p.uncoveredOnly });
      this.last.set(key, result);
      return result;
    }
    return this.inline(key, `run_tests ${callFileId(ctx, toolCallId)}`, signal, async (stop) => {
      const run = await execute(inProjectEnv(p.run, cwd), cwd, stop);
      const log = callOutFile(ctx, toolCallId, "tests");
      writeFileSync(log, run.output);
      const { text: t, ok } = report(run, "tests", p.run.join(" "), p.uncovered, log);
      return text(t, !ok, { changed, tests: p.tests, uncovered: p.uncovered, log });
    });
  }
}

function gitRoot(dir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(`run_tests: cannot find the git root of ${dir}. Run it in a git repository.`, { cause: err });
  }
}

/** The changed files of a git root and their content. */
const state = (root: string) => fingerprint(root, "state", changedFiles(root));

function again(result: Result): Result {
  const [first, ...rest] = result.content[0].text.split("\n");
  const text = [`${first} · no file changed since the last run; same result, nothing ran`, ...rest].join("\n");
  return { ...result, content: [{ type: "text", text }] };
}

export type { Plan } from "../../../shared/testrun.ts";
export { changedFiles, execute, inGit, plan } from "../../../shared/testrun.ts";
