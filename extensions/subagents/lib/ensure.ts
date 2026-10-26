import type { Timers } from "./lifecycle.ts";
import { sessionName, type Tmux } from "./tmux.ts";

export const SOCKET_OPTION = "@pi-sub-socket";
export const SUPERVISOR_WINDOW = "supervisor";
export const POLL_MS = 50;
export const START_TIMEOUT_MS = 5000;

export interface EnsureOptions {
  tmux: Pick<Tmux, "hasSession" | "openWindow" | "listWindows" | "getOption" | "unsetOption">;
  probe: (socket: string) => Promise<boolean>;
  timers: Timers;
  sessionId: string;
  supervisorPath: string;
  execPath: string;
  piCommand: string;
  extensionPath: string;
  runtimeRoot: string;
  pollMs?: number;
  timeoutMs?: number;
}

function sleep(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => timers.setTimeout(resolve, ms));
}

export async function ensureSupervisor(options: EnsureOptions): Promise<{ session: string; socket: string }> {
  const session = sessionName(options.sessionId);
  const known = await options.tmux.getOption(session, SOCKET_OPTION);
  let start = false;
  if (known !== undefined) {
    if (await options.probe(known)) return { session, socket: known };
    const windows = await options.tmux.listWindows(session);
    if (windows.some((window) => window.name === SUPERVISOR_WINDOW)) {
      throw new Error(
        `subagents: ${SOCKET_OPTION} of "${session}" points to "${known}", which does not answer, but the window "${SUPERVISOR_WINDOW}" exists. Run "tmux attach -t ${session}" and read the error.`,
      );
    }
    await options.tmux.unsetOption(session, SOCKET_OPTION);
    start = true;
  } else {
    start = !(await options.tmux.hasSession(session));
  }

  if (start) {
    // pi ships as a compiled bun binary: process.execPath is pi itself, and runs a script only with BUN_BE_BUN.
    // Set it through env, not tmux -e: tmux -e on new-session reaches every later window, and the subagent pi would run as bun.
    await options.tmux.openWindow(session, SUPERVISOR_WINDOW, [
      "env",
      "BUN_BE_BUN=1",
      options.execPath,
      options.supervisorPath,
      "--session",
      session,
      "--dir",
      `${options.runtimeRoot}/${session}`,
      "--pi",
      options.piCommand,
      "--extension",
      options.extensionPath,
    ]);
  }

  const pollMs = options.pollMs ?? POLL_MS;
  const timeoutMs = options.timeoutMs ?? START_TIMEOUT_MS;
  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    await sleep(options.timers, pollMs);
    const socket = await options.tmux.getOption(session, SOCKET_OPTION);
    if (socket !== undefined) return { session, socket };
  }
  throw new Error(
    `subagents: the supervisor of tmux session "${session}" did not set ${SOCKET_OPTION} within ${timeoutMs} ms. Run "tmux attach -t ${session}" to see the error.`,
  );
}
