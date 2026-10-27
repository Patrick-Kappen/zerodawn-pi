import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { callFileId, callOutFile, outRef } from "../../../shared/store.ts";
import { CHANGED_RECIPE, changedFiles, execute, inGit, inProjectEnv, plan, type Run, reader, TIMEOUT_MS } from "../../../shared/testrun.ts";
import { absolutePath } from "../../../shared/util.ts";
import { loadRecipes } from "./recipes.ts";
import { counts, type Diagnosis, diagnose, failures, warningLines } from "./report.ts";

const INLINE_MS = 15 * 1000;
const RERUN = "# rerun";

type Result = { content: { type: "text"; text: string }[]; details: Record<string, unknown>; isError: boolean; terminate?: boolean };

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
    `A run over ${INLINE_MS / 1000} s ends your turn; a message gives the result.`,
    "With no changed file it gives the earlier result.",
  ].join(" "),
  promptSnippet: "Run the tests for the changed files; green in one line, or only the failures",
};

export type Params = { scope?: "changed" | "all"; rerun?: boolean; path?: string };

const LEADING_CD = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/;

/** The directory of a leading "cd <dir> &&" in a command, without quotes. */
export function cdOf(command: string): string | undefined {
  return command.match(LEADING_CD)?.[1].replace(/^["']|["']$/g, "");
}

const LATER = "A message gives the result.";
const TEST_HEAD = "run_tests result (use run_tests next time):";
const CHECK_HEAD = "Check result (do not run it again in another form):";

/** The text and the state of a bash call that a test or check run replaced. */
/** background: the run went to the background; the bash call then ends the turn. */
export type Replacement = { text: string; isError: boolean; background: boolean };

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
      const r = await this.execute(toolCallId, { path: cdOf(command), rerun: command.includes(RERUN) }, ctx.signal, ctx);
      return { text: `${TEST_HEAD}\n${r.content[0].text}`, isError: r.isError, background: r.details.background === true };
    } catch (err) {
      return { text: `${TEST_HEAD}\n${(err as Error).message}`, isError: true, background: false };
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
        return { text: `${CHECK_HEAD}\n${again(earlier, `add "${RERUN}" to run it again`).content[0].text}`, isError: earlier.isError, background: false };
      const r = await this.inline(key, `check ${callFileId(ctx, toolCallId)}`, ctx.signal, async (signal) => {
        const run = await execute(inProjectEnv(["bash", "-c", command], dir), ctx.cwd, signal);
        const log = callOutFile(ctx, toolCallId, "check");
        writeFileSync(log, run.output);
        const { text: t, ok } = report(run, "check", command, [], log);
        return text(t, !ok, { log });
      });
      return { text: `${CHECK_HEAD}\n${r.content[0].text}`, isError: r.isError, background: r.details.background === true };
    } catch (err) {
      return { text: `${CHECK_HEAD}\n${(err as Error).message}`, isError: true, background: false };
    }
  }

  /** Starts a run and waits up to inlineMs for it. A later result goes to notify. A second call for the same key does not start a second run. */
  private async inline(key: string, label: string, signal: AbortSignal | undefined, start: (signal: AbortSignal) => Promise<Result>): Promise<Result> {
    if (this.running.has(key)) return { ...text(`${label} still runs for this change. ${LATER}`, false, { background: true }), terminate: true };
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
    return { ...text(`${label}: background (more than ${this.inlineMs / 1000} s). ${LATER}`, false, { background: true }), terminate: true };
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
    return this.inline(key, `run_tests ${callFileId(ctx, toolCallId)}`, signal, async (stop) => {
      const run = await execute(inProjectEnv(p.run, cwd), cwd, stop);
      const log = callOutFile(ctx, toolCallId, "tests");
      writeFileSync(log, run.output);
      const { text: t, ok } = report(run, "tests", p.run.join(" "), p.uncovered, log);
      return text(t, !ok, { changed, tests: p.tests, uncovered: p.uncovered, log });
    });
  }
}

function again(result: Result, how: string): Result {
  const [first, ...rest] = result.content[0].text.split("\n");
  const text = [`${first} · no file changed since the last run; same result (${how})`, ...rest].join("\n");
  return { ...result, content: [{ type: "text", text }] };
}

export type { Plan } from "../../../shared/testrun.ts";
export { changedFiles, execute, inGit, plan } from "../../../shared/testrun.ts";
