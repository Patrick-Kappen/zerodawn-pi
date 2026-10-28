type Entry = { type?: string; message?: { role?: string; content?: unknown } };

/** True when the call is the only tool call of its assistant message: the agent has no other work until the result. */
export function aloneInMessage(entries: unknown[], toolCallId: string): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as Entry;
    if (e?.type !== "message" || e.message?.role !== "assistant" || !Array.isArray(e.message.content)) continue;
    const ids = (e.message.content as { type?: string; id?: string }[]).filter((c) => c?.type === "toolCall").map((c) => c.id);
    if (ids.includes(toolCallId)) return ids.length === 1;
  }
  // A nested call (codemode, ctx.executeTool) is not in a message: its caller can have other work.
  return false;
}
