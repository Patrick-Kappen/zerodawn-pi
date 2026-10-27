export const WARN_AT = [130_000, 140_000];
export const CUT_AT = 150_000;
export const HARD_AT = 170_000;
export const WARM_BELOW = 100_000;

export type Boundary = "turn_end" | "settle";
export type Decision = { action: "none" } | { action: "warn"; level: number } | { action: "cut"; why: string };

export function decide(tokens: number, boundary: Boundary, warned: number, jobsRunning: boolean): Decision {
  if (tokens >= HARD_AT) return { action: "cut", why: `context ${k(tokens)} over the hard limit of ${k(HARD_AT)}` };
  if (boundary === "settle" && tokens >= CUT_AT && !jobsRunning) return { action: "cut", why: `context ${k(tokens)} at the end of the run` };
  const level = WARN_AT.filter((at) => tokens >= at).length;
  if (boundary === "turn_end" && level > warned) return { action: "warn", level };
  return { action: "none" };
}

export const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

export function warning(tokens: number, jobsRunning: boolean): string {
  const wait = jobsRunning ? " Running bash jobs report first." : "";
  return `System: context ${k(tokens)} of ${k(CUT_AT)}. Finish this step, then end the run; a handoff replaces the context when the run ends.${wait}`;
}

export const RESUME = "System: the context was replaced by the handoff above. Continue with its Next step.";

export function warmDecision(tokens: number, jobsRunning: boolean): "warm" | undefined {
  return jobsRunning && tokens > 0 && tokens < WARM_BELOW ? "warm" : undefined;
}
