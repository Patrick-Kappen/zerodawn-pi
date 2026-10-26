const FAILURE_MAX = 150;
const TAIL = 40;
const COUNT = /^\s*(\d+) (pass|fail|skip|todo)\b/;
const NOISE = /^\s*(> )?(✓ |\(pass\) |bun test v)|^warning: Git tree '.*' is dirty$/;
const RUNTIME_FRAME = /^\s*at (.*\()?node:/;
const WARNING = /(?<!-)warn(?!-)|^\s*! /i;
const NO_WARNING = /\b(0|no)\s+warn/i;
const BEFORE = 2;
const BLOCK_MAX = 12;

/** Counts from bun test output, such as "38 pass, 0 fail"; undefined for other runners. */
export function counts(output: string): string | undefined {
  const found = output
    .split("\n")
    .map((l) => l.match(COUNT))
    .filter((m) => m !== null)
    .map((m) => `${m[1]} ${m[2]}`);
  return found.length ? found.join(", ") : undefined;
}

const clean = (output: string) =>
  output
    .split("\n")
    .filter((l) => !NOISE.test(l) && !RUNTIME_FRAME.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n");

function cap(lines: string[]): string {
  if (lines.length <= FAILURE_MAX) return lines.join("\n");
  const head = lines.slice(0, FAILURE_MAX - TAIL);
  return [...head, `… ${lines.length - head.length - TAIL} lines more in the log …`, ...lines.slice(-TAIL)].join("\n");
}

/** The part of a failed run that the agent needs: no passed tests, no runtime stack frames, no version line, at most FAILURE_MAX lines. */
export function failures(output: string): string {
  return cap(clean(output));
}

/** Number of warning lines: a line with "warn", or a line that starts with "! " (biome). Not "0 warnings", and not an option such as --error-on-warnings or warn-dirty in an echoed command. */
export function warningCount(output: string): number {
  return clean(output).filter((l) => WARNING.test(l) && !NO_WARNING.test(l)).length;
}

/** Each warning line with BEFORE lines before it and the lines after it up to a blank line, at most FAILURE_MAX lines. */
export function warnings(output: string): string {
  const lines = clean(output);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (!WARNING.test(l) || NO_WARNING.test(l)) return;
    for (let j = Math.max(0, i - BEFORE); j < i; j++) keep.add(j);
    for (let j = i; j < lines.length && j < i + BLOCK_MAX && (j === i || lines[j].trim()); j++) keep.add(j);
  });
  const out: string[] = [];
  [...keep]
    .sort((a, b) => a - b)
    .forEach((i, n, all) => {
      if (n > 0 && i !== all[n - 1] + 1) out.push("…");
      out.push(lines[i]);
    });
  return cap(out);
}

const ERROR = /\berror\b|\bfail(ed|ure)?\b/i;
const LOCATION = /\S+\.\w+(:\d+(:\d+)?|\(\d+,\d+\))/;
const SUMMARY = /^\s*(Found|Checked) \d+ /;
const LAST = 20;

/**
 * The diagnostics of a check or a warning: each line with a location, a warning or an error, once, with its count.
 * No summary lines, no context lines. The last LAST lines when no line matches. At most FAILURE_MAX lines.
 */
export function diagnostics(output: string): string {
  const lines = clean(output);
  const seen = new Map<string, number>();
  for (const l of lines) {
    const t = l.trim();
    if (!t || SUMMARY.test(t) || NO_WARNING.test(t) || COUNT.test(t)) continue;
    if (LOCATION.test(t) || WARNING.test(t) || ERROR.test(t)) seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  if (!seen.size) return cap(lines.slice(-LAST));
  return cap([...seen].map(([l, n]) => (n > 1 ? `${l} (×${n})` : l)));
}
