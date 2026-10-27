import { argSummary } from "../../../shared/util.ts";

export const TEXT_MAX = 500;
const RESULT_MAX = 80;

type Part = { type: string; text?: string; name?: string; id?: string; arguments?: unknown };
export type Entry = {
  id: string;
  type: string;
  customType?: string;
  content?: unknown;
  message?: { role: string; content?: unknown; toolCallId?: string; isError?: boolean; customType?: string };
};

const flat = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
};

const parts = (content: unknown): Part[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []);
const textOf = (content: unknown) =>
  parts(content)
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join(" ");

export function strip(entries: Entry[], { ids = false, textMax = TEXT_MAX } = {}): string[] {
  const lines: string[] = [];
  const push = (e: Entry, line: string) => lines.push(ids ? `[${e.id}] ${line}` : line);
  const callLine = new Map<string, number>();
  for (const e of entries) {
    if (e.type === "custom_message") {
      const text = textOf(e.content);
      if (text) push(e, `event ${e.customType}: ${flat(text, RESULT_MAX)}`);
      continue;
    }
    const m = e.message;
    if (e.type !== "message" || !m) continue;
    if (m.role === "user") {
      const text = textOf(m.content);
      if (text) push(e, `user: ${flat(text, textMax)}`);
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text.trim()) push(e, `assistant: ${flat(text, textMax)}`);
      for (const p of parts(m.content).filter((p) => p.type === "toolCall")) {
        callLine.set(p.id ?? "", lines.length);
        push(e, `${p.name}: ${argSummary(p.arguments, 120)}`);
      }
    } else if (m.role === "toolResult") {
      const at = callLine.get(m.toolCallId ?? "");
      if (at === undefined) continue;
      const first = textOf(m.content).split("\n")[0] ?? "";
      lines[at] += ` → ${m.isError ? "error: " : ""}${flat(first, RESULT_MAX)}`;
    }
  }
  return lines;
}
