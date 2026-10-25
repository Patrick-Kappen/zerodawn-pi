
type Fix = { oldText: string; newText: string };

const indentOf = (line: string) => line.match(/^[ \t]*/)![0];

export function fixIndent(text: string, oldText: string, newText: string): Fix | undefined {
  const old = oldText.split("\n");
  const lines = text.split("\n");
  const key = (ls: string[]) => ls.map((l) => l.trim()).join("\n");
  const want = key(old);
  if (!want.trim()) return undefined;
  const at: number[] = [];
  for (let i = 0; i + old.length <= lines.length; i++) if (key(lines.slice(i, i + old.length)) === want) at.push(i);
  if (at.length !== 1) return undefined;
  const real = lines.slice(at[0], at[0] + old.length);
  const first = old.findIndex((l) => l.trim());
  const O = indentOf(old[first]);
  const A = indentOf(real[first]);
  for (let i = 0; i < old.length; i++) {
    if (!old[i].trim()) continue;
    const oi = indentOf(old[i]);
    if (!oi.startsWith(O) || indentOf(real[i]) !== A + oi.slice(O.length)) return undefined;
  }
  const reindent = (l: string) => (l.trim() && l.startsWith(O) ? A + l.slice(O.length) : l);
  return { oldText: real.join("\n"), newText: newText.split("\n").map(reindent).join("\n") };
}

function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const t = s.split("\n").map((l) => l.trim()).join("\n");
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const pa = pairs(a), pb = pairs(b);
  let shared = 0, total = 0;
  for (const [k, n] of pa) shared += Math.min(n, pb.get(k) ?? 0);
  for (const n of pa.values()) total += n;
  for (const n of pb.values()) total += n;
  return total ? (2 * shared) / total : 0;
}

export function nearest(text: string, oldText: string): { from: number; to: number; score: number; region: string } | undefined {
  const n = oldText.split("\n").length;
  const lines = text.split("\n");
  let best = { from: 0, score: 0 };
  for (let i = 0; i + n <= lines.length; i++) {
    const s = similarity(oldText, lines.slice(i, i + n).join("\n"));
    if (s > best.score) best = { from: i, score: s };
  }
  if (best.score < 0.5) return undefined;
  const region = lines.slice(best.from, best.from + n).map((l, k) => `${best.from + k + 1}| ${l}`).join("\n");
  return { from: best.from + 1, to: best.from + n, score: best.score, region };
}

export function freshLines(text: string, newTexts: string[], margin = 3): string | undefined {
  const lines = text.split("\n");
  const ranges: [number, number][] = [];
  for (const n of newTexts) {
    const at = n ? text.indexOf(n) : -1;
    if (at < 0) continue;
    const first = text.slice(0, at).split("\n").length;
    const last = first + n.split("\n").length - 1;
    const edges: [number, number][] = last - first + 1 > 2 * margin + 2 ? [[first, first + margin - 1], [last - margin + 1, last]] : [[first, last]];
    for (const [a, b] of edges) ranges.push([Math.max(1, a - margin), Math.min(lines.length, b + margin)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([...r]);
  }
  const parts = merged.map(([from, to]) => lines.slice(from - 1, to).map((l, k) => `${from + k}| ${l}`).join("\n"));
  return parts.length ? `Current lines (the "N| " prefix is not part of the file):\n${parts.join("\n...\n")}` : undefined;
}

export function explain(text: string, oldText: string, newText: string): string {
  if (newText.includes(oldText.trim()) && oldText.trim())
    return "oldText must be text that is already in the file. To insert, use the line before or after the new text as oldText and repeat it in newText.";
  const near = nearest(text, oldText);
  if (!near) return "Nothing in the file is like oldText. Search for it with grep, then read that range.";
  return `The most similar place (${Math.round(near.score * 100)}% alike) is lines ${near.from}-${near.to}. Copy oldText from it exactly (the "N| " prefix is not part of the file):\n${near.region}`;
}
