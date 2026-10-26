export const KEEP_TURNS = 2;
export const MIN_CHARS = 1500;
export const BATCH_CHARS = 16_000;

type Content = { type: string; text?: string };
type Entry = {
  type: string;
  id: string;
  targetId?: string;
  message?: {
    role: string;
    toolName?: string;
    customType?: string;
    content?: Content[] | string;
    details?: Record<string, unknown>;
    isError?: boolean;
  };
};

const PRUNED_CUSTOM = new Set(["bash-job"]);

const prunable = (m: Entry["message"]): boolean =>
  m?.role === "toolResult" || (m?.role === "custom" && m.customType !== undefined && PRUNED_CUSTOM.has(m.customType));

export type Edit = { targetId: string; replacement: { content: string } };

function textOf(content: Content[] | string | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

const jobLogs = (items: unknown): string[] =>
  Array.isArray(items) ? items.map((it) => (it as { log?: unknown }).log).filter((l): l is string => typeof l === "string") : [];

export function stub(toolName: string, text: string, details: Record<string, unknown> | undefined, isError: boolean | undefined): string {
  const lines = text.split("\n");
  const size = `${lines.length} lines, ${text.length} chars`;
  const first = lines[0]?.slice(0, 120) ?? "";
  const logs = typeof details?.log === "string" ? [details.log] : jobLogs(details?.items);
  const log = logs.length > 0 ? ` Full output: ${logs.join(", ")}` : "";
  const state = isError ? "error" : "result";
  return `[pruned ${toolName} ${state}: ${size}. First line: ${first}.${log || " Run the tool again when you need it."}]`;
}

export function selectEdits(branch: Entry[], keepTurns = KEEP_TURNS, minChars = MIN_CHARS, batchChars = BATCH_CHARS): Edit[] {
  const edited = new Set(branch.filter((e) => e.type === "context_edit" && e.targetId).map((e) => e.targetId as string));
  const usersAfter: number[] = new Array(branch.length).fill(0);
  let users = 0;
  for (let i = branch.length - 1; i >= 0; i--) {
    usersAfter[i] = users;
    if (branch[i].type === "message" && branch[i].message?.role === "user") users++;
  }
  const edits: Edit[] = [];
  branch.forEach((e, i) => {
    const m = e.message;
    if (e.type !== "message" || !m || !prunable(m) || edited.has(e.id)) return;
    if (usersAfter[i] < keepTurns) return;
    const text = textOf(m.content);
    if (text.length < minChars) return;
    edits.push({ targetId: e.id, replacement: { content: stub(m.toolName ?? m.customType ?? "tool", text, m.details, m.isError) } });
  });
  return prunedChars(branch, edits) >= batchChars ? edits : [];
}

export const prunedChars = (branch: Entry[], edits: Edit[]): number =>
  edits.reduce((sum, edit) => sum + textOf(branch.find((e) => e.id === edit.targetId)?.message?.content).length - edit.replacement.content.length, 0);
