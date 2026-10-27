import { createHash } from "node:crypto";

export type SeenRange = { from: number; hashes: string[] };
export type Seen = { path: string; ranges: SeenRange[] };

const MIN_RUN = 3;
const MAX_ANCHORS = 5;

export const hashLine = (line: string) => createHash("sha1").update(line).digest("base64").slice(0, 10);

export function fileLines(text: string): string[] {
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

export function seenRanges(lines: string[], ranges: [number, number][]): SeenRange[] {
  return ranges.map(([from, to]) => ({ from, hashes: lines.slice(from - 1, to).map(hashLine) }));
}

// An earlier range counts where its lines are still in the file: at the same place, or moved by an edit above it.
export function linesInContext(current: string[], ranges: SeenRange[]): Set<number> {
  const hashes = current.map(hashLine);
  const where = new Map<string, number[]>();
  hashes.forEach((h, i) => {
    where.set(h, [...(where.get(h) ?? []), i]);
  });
  const seen = new Set<number>();
  for (const r of ranges) {
    const n = r.hashes.length;
    if (!n) continue;
    const shifts = new Set([0]);
    const anchors = r.hashes
      .map((h, i) => ({ i, at: where.get(h) ?? [] }))
      .filter((a) => a.at.length > 0 && a.at.length <= MAX_ANCHORS)
      .sort((a, b) => a.at.length - b.at.length);
    for (const a of anchors.slice(0, 2)) for (const j of a.at) shifts.add(j - (r.from - 1 + a.i));
    const run = Math.min(MIN_RUN, n);
    for (const shift of shifts) {
      let start = -1;
      for (let i = 0; i <= n; i++) {
        const j = r.from - 1 + i + shift;
        const match = i < n && hashes[j] === r.hashes[i];
        if (match && start < 0) start = i;
        if (match || start < 0) continue;
        if (i - start >= run) for (let k = start; k < i; k++) seen.add(r.from + k + shift);
        start = -1;
      }
    }
  }
  return seen;
}

export function segments(from: number, to: number, skip: Set<number>): [number, number][] {
  const out: [number, number][] = [];
  for (let n = from; n <= to; n++) {
    if (skip.has(n)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === n - 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}
