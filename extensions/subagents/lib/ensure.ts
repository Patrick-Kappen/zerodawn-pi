import type { Timers } from "./lifecycle.ts";
import { sessionName, type Tmux } from "./tmux.ts";

export const SOCKET_OPTION = "@pi-sub-socket";
export const POLL_MS = 50;
export const START_TIMEOUT_MS = 5000;

export interface EnsureOptions {
  tmux: Pick<Tmux, "hasSession" | "openWindow" | "getOption">;
  timers: Timers;
  sessionId: string;
  supervisorPath: string;
  execPath: string;
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
  if (known !== undefined) return { session, socket: known };

  if (!(await options.tmux.hasSession(session))) {
    await options.tmux.openWindow(session, "supervisor", [
      options.execPath,
      options.supervisorPath,
      "--session",
      session,
      "--dir",
      `${options.runtimeRoot}/${session}`,
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
