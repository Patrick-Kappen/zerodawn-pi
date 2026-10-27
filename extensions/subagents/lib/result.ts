import type { AgentResult } from "./protocol.ts";

export const MAX_DETAIL_EVENTS = 20;
export const MAX_DETAIL_LINE = 200;

function shapeDetails(result: AgentResult) {
  return {
    id: result.id,
    status: result.status,
    usage: result.usage,
    model: result.model,
    ...(result.failedModels === undefined ? {} : { failedModels: result.failedModels }),
    events: result.events.slice(-MAX_DETAIL_EVENTS).map((event) => event.slice(0, MAX_DETAIL_LINE)),
    ...(result.blocker === undefined ? {} : { blocker: result.blocker }),
    ...(result.handoff === undefined ? {} : { handoff: result.handoff }),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(result.gate === undefined ? {} : { gate: result.gate }),
    ...(result.commit === undefined ? {} : { commit: result.commit }),
    ...(result.worktree === undefined ? {} : { worktree: result.worktree }),
    ...(result.branch === undefined ? {} : { branch: result.branch }),
  };
}

function modelLine(result: AgentResult): string {
  const failed = (result.failedModels ?? []).map((item) => `${item.model} (${item.reason})`).join(", ");
  return `model: ${result.model}${failed === "" ? "" : `; failed: ${failed}`}`;
}

function treeText(result: AgentResult): string {
  if (result.worktree === undefined) return "";
  const commit = result.commit === undefined ? "" : `\ncommit: ${result.commit.slice(0, 7)} ${result.handoff?.subject ?? ""}`;
  return `\nworktree: ${result.worktree}\nbranch: ${result.branch}${commit}`;
}

export function shapeResult(result: AgentResult) {
  const text = result.text;
  if (result.status === "question" || result.status === "blocked") {
    return {
      content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${modelLine(result)}\n${text}${treeText(result)}` }],
      details: shapeDetails(result),
    };
  }
  const usage = `${result.usage.tokens} tokens, $${result.usage.cost.toFixed(4)}`;
  return {
    content: [{ type: "text" as const, text: `agent ${result.id}\nstatus: ${result.status}\n${modelLine(result)}\n${text}${treeText(result)}\n${usage}` }],
    details: shapeDetails(result),
  };
}
