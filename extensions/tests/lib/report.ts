const FAILURE_MAX = 150;
const TAIL = 40;
const COUNT = /^\s*(\d+) (pass|fail|skip|todo)\b/;
const NOISE = /^\s*(✓ |\(pass\) |bun test v)/;
const RUNTIME_FRAME = /^\s*at (.*\()?node:/;

/** Counts from bun test output, such as "38 pass, 0 fail"; undefined for other runners. */
export function counts(output: string): string | undefined {
  const found = output
    .split("\n")
    .map((l) => l.match(COUNT))
    .filter((m) => m !== null)
    .map((m) => `${m[1]} ${m[2]}`);
  return found.length ? found.join(", ") : undefined;
}

/** The part of a failed run that the agent needs: no passed tests, no runtime stack frames, no version line, at most FAILURE_MAX lines. */
export function failures(output: string): string {
  const lines = output
    .split("\n")
    .filter((l) => !NOISE.test(l) && !RUNTIME_FRAME.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n");
  if (lines.length <= FAILURE_MAX) return lines.join("\n");
  const head = lines.slice(0, FAILURE_MAX - TAIL);
  return [...head, `… ${lines.length - head.length - TAIL} lines more in the log …`, ...lines.slice(-TAIL)].join("\n");
}
