import type { Entry } from "./transcript.ts";

export const UPDATE_CHARS = 20_000;

const MILESTONES: [RegExp, string][] = [
  [/\bgit\b[^;&|]*\bcommit\b/, "commit"],
  [/\bgit\b[^;&|]*\bpush\b/, "push"],
  [/\bgh\s+pr\s+create\b/, "PR created"],
  [/\bgh\s+pr\s+merge\b/, "PR merged"],
];

type Part = { type: string; id?: string; name?: string; text?: string; arguments?: { command?: unknown } };

const firstText = (content: unknown) =>
  typeof content === "string" ? content : Array.isArray(content) ? ((content as Part[]).find((p) => p.type === "text")?.text ?? "") : "";

export function milestones(entries: Entry[]): string[] {
  const commands = new Map<string, string>();
  const found = new Set<string>();
  for (const e of entries) {
    const m = e.message;
    if (e.type !== "message" || !m) continue;
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const p of m.content as Part[]) {
        if (p.type === "toolCall" && p.name === "bash" && typeof p.arguments?.command === "string") commands.set(p.id ?? "", p.arguments.command);
      }
    }
    if (m.role === "toolResult" && !m.isError) {
      const command = commands.get(m.toolCallId ?? "");
      if (command === undefined || /^job \S+: running/.test(firstText(m.content))) continue;
      for (const [pattern, name] of MILESTONES) if (pattern.test(command)) found.add(name);
    }
  }
  return [...found];
}

export function updateReasons(entries: Entry[], lines: string[]): string[] {
  const size = lines.reduce((sum, l) => sum + l.length + 1, 0);
  return [...(size >= UPDATE_CHARS ? [`${size} characters`] : []), ...milestones(entries)];
}
