const maxLineLength = 200;

export interface Match {
  file: string;
  text: string;
  lines: string;
  replacement?: string;
  range: { start: { line: number }; end: { line: number } };
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : word.endsWith("h") ? "es" : "s"}`;

export function clip(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > maxLineLength ? `${trimmed.slice(0, maxLineLength)}…` : trimmed;
}

export function format(matches: Match[]): string {
  const byFile = new Map<string, Match[]>();
  for (const match of matches) byFile.set(match.file, [...(byFile.get(match.file) ?? []), match]);
  const out: string[] = [];
  for (const [file, list] of byFile) {
    out.push(file);
    for (const match of list) {
      const start = match.range.start.line + 1;
      const span = match.range.end.line - match.range.start.line;
      const first = clip(match.lines.split("\n")[0] ?? "");
      out.push(`  ${start}: ${first}${span > 0 ? ` (+${span} lines)` : ""}`);
      if (match.replacement !== undefined) out.push(`  ${start}→ ${clip(match.replacement.split("\n")[0] ?? "")}`);
    }
  }
  return out.join("\n");
}
