import type { AgentResult } from "./protocol.ts";

export const MAX_TEXT = 8000;
export const MAX_DETAIL_EVENTS = 20;
export const MAX_DETAIL_LINE = 200;

export function shapeResult(result: AgentResult) {
  const cut = result.text.length - MAX_TEXT;
  const text = cut > 0 ? `${result.text.slice(0, MAX_TEXT)}\n[cut: ${cut} more characters]` : result.text;
  const usage = `${result.usage.tokens} tokens, $${result.usage.cost.toFixed(4)}`;
  return {
    content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${text}\n${usage}` }],
    details: {
      id: result.id,
      status: result.status,
      usage: result.usage,
      events: result.events.slice(-MAX_DETAIL_EVENTS).map((event) => event.slice(0, MAX_DETAIL_LINE)),
    },
  };
}
