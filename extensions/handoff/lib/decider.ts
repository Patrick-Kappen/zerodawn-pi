export const WARN_AT = [130_000, 140_000];
export const CUT_AT = 150_000;
export const HARD_AT = 170_000;
export const WARM_BELOW = 100_000;

export type Boundary = "turn_end" | "settle";
export type Decision = { action: "none" } | { action: "warn"; level: number } | { action: "cut"; why: string };

export function decide(tokens: number, boundary: Boundary, warned: number, jobsRunning: boolean, toolCalls: boolean, requested: boolean): Decision {
  if (tokens >= HARD_AT) return { action: "cut", why: `context ${k(tokens)} over the hard limit of ${k(HARD_AT)}` };
  if (boundary === "turn_end" && requested && toolCalls && !jobsRunning) return { action: "cut", why: `context ${k(tokens)}, the agent called handoff` };
  if (boundary === "turn_end" && tokens >= CUT_AT && toolCalls && !jobsRunning) return { action: "cut", why: `context ${k(tokens)} in the middle of the work` };
  if (boundary === "settle" && tokens >= CUT_AT && !jobsRunning) return { action: "cut", why: `context ${k(tokens)} at the end of the run` };
  if (boundary === "settle" && requested && !jobsRunning) return { action: "cut", why: `context ${k(tokens)} at the end of the run, the agent called handoff` };
  if (boundary === "settle" && warned > 0 && !jobsRunning) return { action: "cut", why: `context ${k(tokens)} at the end of the run after the warning` };
  const level = WARN_AT.filter((at) => tokens >= at).length;
  if (boundary === "turn_end" && level > warned) return { action: "warn", level };
  return { action: "none" };
}

export const k = (tokens: number) => `${Math.round(tokens / 1000)}k`;

export function warning(tokens: number): string {
  const percent = Math.round((tokens / CUT_AT) * 100);
  return `System: context ${percent}%; ${k(Math.max(0, CUT_AT - tokens))} tokens left. Continue working or call handoff for an early handoff.`;
}

export const RESUME = "System: the context was replaced by the handoff above. Go on now with In progress and Next 1. Do not ask the user to continue.";

export function warmDecision(tokens: number, jobsRunning: boolean): "warm" | undefined {
  return jobsRunning && tokens > 0 && tokens < WARM_BELOW ? "warm" : undefined;
}
