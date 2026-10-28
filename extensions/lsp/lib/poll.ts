/** Milliseconds between two samples of the nvim buffer. */
export const POLL_MS = 200;
/** A filetype without an attached LSP client is not an error; stop waiting after this. */
export const CLIENT_WAIT_MS = 3000;
/** The diagnostics counter must not change for this long before the result is stable. */
export const STABLE_MS = 500;
/** No stable result by then is an error when a client is attached. */
export const TIMEOUT_MS = 15_000;

/** A client with no open progress and no progress event for this long has finished, even when it published nothing. */
export const QUIET_MS = 3000;

/** `busy`: open progress tokens; `quiet`: ms since the last progress or attach event. Both default to 0. */
export type Sample = { clients: number; counter: number; busy?: number; quiet?: number };
export type Verdict = "done" | "none" | "timeout" | "wait";

/**
 * The next step of the poll. A counter above zero that held still for STABLE_MS is done.
 * Without an attached client after CLIENT_WAIT_MS there is no LSP for this filetype.
 * A client that does not give a stable result before TIMEOUT_MS is an error.
 */
export function pollDecision(sample: Sample, elapsedMs: number, counterStableMs: number): Verdict {
  if (sample.counter > 0 && counterStableMs >= STABLE_MS) return "done";
  // A clean file: some servers (vtsls) publish nothing. Quiet progress for QUIET_MS means no errors.
  if (sample.counter === 0 && sample.clients > 0 && (sample.busy ?? 0) === 0 && (sample.quiet ?? 0) >= QUIET_MS) return "done";
  if (elapsedMs >= TIMEOUT_MS) return "timeout";
  if (sample.clients === 0 && elapsedMs >= CLIENT_WAIT_MS) return "none";
  return "wait";
}
