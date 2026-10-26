import { type Run, verdict } from "../../../shared/testrun.ts";

export interface GateDeps {
  checks: string[];
  changed: () => string[];
  uncovered: (changed: string[]) => string[];
  testCommand: () => string[];
  run: (argv: string[]) => Promise<Run>;
  sendUserMessage: (text: string) => void;
}

export interface GateResult {
  ok: boolean;
  reason: string;
}

const AGAIN = "Then finish again.";

function red(deps: GateDeps, reason: string, text: string): GateResult {
  deps.sendUserMessage(`The done gate is red: ${reason}.\n${text}`);
  return { ok: false, reason };
}

/** Runs the done gate. Red: tells the subagent what to fix and returns ok false. */
export async function runGate(deps: GateDeps): Promise<GateResult> {
  const changed = deps.changed();
  if (changed.length === 0) return { ok: true, reason: "no changed files" };

  const uncovered = deps.uncovered(changed);
  if (uncovered.length > 0) {
    return red(
      deps,
      `no test for ${uncovered.length} changed files`,
      `No test for: ${uncovered.join(", ")}. Add a test file that imports each of them, at the place and in the form that the AGENTS.md or README of the project gives. ${AGAIN}`,
    );
  }

  let argv: string[];
  try {
    argv = deps.testCommand();
  } catch (error) {
    return red(deps, "no way to run every test", `${(error as Error).message} ${AGAIN}`);
  }
  const tests = verdict(await deps.run(argv));
  if (!tests.ok) return red(deps, "the repository tests are red", `Command: ${argv.join(" ")}\n${tests.text}\nFix them. ${AGAIN}`);

  for (const check of deps.checks) {
    const result = verdict(await deps.run(["bash", "-c", check]));
    if (!result.ok) return red(deps, `the check "${check}" is red`, `${result.text}\nFix it. ${AGAIN}`);
  }
  return { ok: true, reason: "tests and checks green" };
}
