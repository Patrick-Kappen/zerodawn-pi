import type { AgentResult } from "./protocol.ts";

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
    ...(result.gate === undefined ? {} : { gate: result.gate }),
    ...(result.worktree === undefined ? {} : { worktree: result.worktree }),
    ...(result.branch === undefined ? {} : { branch: result.branch }),
  };
}

function treeText(result: AgentResult): string {
  return result.worktree === undefined ? "" : `\nworktree: ${result.worktree}\nbranch: ${result.branch}`;
}

export function shapeResult(result: AgentResult) {
  const text = result.text;
  if (result.status === "question" || result.status === "blocked") {
    return {
      content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${text}${treeText(result)}` }],
      details: shapeDetails(result),
    };
  }
  const usage = `${result.usage.tokens} tokens, $${result.usage.cost.toFixed(4)}`;
  return {
    content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${text}${treeText(result)}\n${usage}` }],
    details: shapeDetails(result),
  };
}
