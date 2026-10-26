import type { AgentResult } from "./protocol.ts";

export const MAX_TEXT = 8000;
export const MAX_DETAIL_EVENTS = 20;
export const MAX_DETAIL_LINE = 200;

function shapeDetails(result: AgentResult) {
  return {
    id: result.id,
    status: result.status,
    usage: result.usage,
    events: result.events.slice(-MAX_DETAIL_EVENTS).map((event) => event.slice(0, MAX_DETAIL_LINE)),
    ...(result.blocker === undefined ? {} : { blocker: result.blocker }),
    ...(result.handoff === undefined ? {} : { handoff: result.handoff }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

export function shapeResult(result: AgentResult) {
  const cut = result.text.length - MAX_TEXT;
  const text = cut > 0 ? `${result.text.slice(0, MAX_TEXT)}\n[cut: ${cut} more characters]` : result.text;
  if (result.status === "question" || result.status === "blocked") {
    return {
      content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${text}` }],
      details: shapeDetails(result),
    };
  }
  const usage = `${result.usage.tokens} tokens, $${result.usage.cost.toFixed(4)}`;
  return {
    content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${text}\n${usage}` }],
    details: shapeDetails(result),
  };
}
