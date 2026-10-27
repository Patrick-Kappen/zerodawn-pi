const FAILURE_MAX = 150;
const TAIL = 40;
const COUNT = /^\s*(\d+) (pass|fail|skip|todo)\b/;
const NOISE =
  /^\s*(> )?(✓ |\(pass\) |bun test v)|^warning: Git tree '.*' is dirty$|^error \(ignored\): SQLite database '.*' is busy$|^(building|copying path|evaluating|checking outputs of) '?\/nix\/store\/|^these \d+ (derivations|paths) will be|^\s+\/nix\/store\/\S+$/;
/** The prefix of a line from a nix build log, as nix shows it after a failed build. */
const NIX_LOG = /^\s+>\s?/;
const SUMMARY = /^\s*((Found|Checked) \d+ |\S+ Some (warnings|errors) were emitted)/;
const RUNTIME_FRAME = /^\s*at (.*\()?node:/;
/** "warn", "warning", "warnings" as a word end: not in an option (--error-on-warnings, warn-dirty) or a name (warningCount). */
const WARNING_ANY = /(?<!-)warn(?!-)|^\s*! /i;
const WARNING = /(?<!-)warn(ing)?s?(?![\w-])|^\s*! /i;
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
    .map((l) => l.replace(NIX_LOG, ""))
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

/** Number of warning lines: a line with "warn", or a line that starts with "! " (biome). Not "0 warnings", not a summary such as "Found 1 warning.", and not an option such as --error-on-warnings or warn-dirty in an echoed command. */
export function warningCount(output: string): number {
  return clean(output).filter((l) => WARNING_ANY.test(l) && !NO_WARNING.test(l)).length;
}

/** Number of warning lines, as warningCount, but "warn" only as a word (not in warningCount), and no summary lines such as "Found 1 warning.". */
export function warningLines(output: string): number {
  return clean(output).filter((l) => WARNING.test(l) && !NO_WARNING.test(l) && !SUMMARY.test(l)).length;
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

const ERROR = /(?<![-\w])(error|fail(ed|ure)?)\b|\bnix log\b|not found|not formatted|no such file|permission denied|\bcannot\b/i;
const LOCATION = /\S+\.\w+(:\d+(:\d+)?|\(\d+,\d+\))/;
/** A line that starts with a location: file, position, message. */
const LEADING = /^(\S+?\.\w+)(:\d+(?::\d+)?|\(\d+,\d+\)):?\s+(.*)$/;
/** A location on its own line, for the message lines under it: shellcheck "In a.sh line 3:", miette "╭─[a.nix:2:5]", biome "a.ts format ━━━" (no position). */
const HEADER = [/^In (\S+) line (\d+):$/, /^╭─\[(\S+?):(\d+(?::\d+)?)\]$/, /^(\S+?\.\w+) (?:format|organizeImports|(?:lint|assist)\/\S+)$/];
/** A message line under a HEADER: shellcheck "^-- SC2086 (info): …", miette "╰─ …", biome "× …". */
const UNDER = /(SC\d{4} \(\w+\): .*)$|╰─ (.*)$|^[×!] (.*)$/;
const DECORATION = /\s+(FIXABLE\s+)?━+$/;
const LAST = 20;
const PLACES = 10;

/** The result of diagnose(): the text, and the facts that show a result the parser did not understand. */
export interface Diagnosis {
  text: string;
  /** No line matched; the text is the last LAST lines. */
  fallback: boolean;
  /** The text was cut at FAILURE_MAX lines. */
  capped: boolean;
  /** Number of diagnostics with a location. */
  located: number;
}

/**
 * The diagnostics of a check or a warning: each line with a location, a warning or an error, once.
 * The same message at more places is one line with the places. A location on its own line goes in front of its message.
 * No summary lines, no context lines. The last LAST lines when no line matches. At most FAILURE_MAX lines.
 */
export function diagnose(output: string): Diagnosis {
  const lines = clean(output);
  const groups = new Map<string, { file: string; places: string[]; message: string; count: number }>();
  const add = (file: string, place: string, message: string) => {
    const key = `${file}\0${message}`;
    const g = groups.get(key) ?? { file, places: [], message, count: 0 };
    g.count++;
    if (place && !g.places.includes(place)) g.places.push(place);
    groups.set(key, g);
  };
  let header: { file: string; place: string } | undefined;
  for (const l of lines) {
    const t = l.trim().replace(DECORATION, "");
    if (!t || SUMMARY.test(t) || NO_WARNING.test(t) || COUNT.test(t)) continue;
    const h = HEADER.map((r) => t.match(r)).find((m) => m);
    if (h) {
      header = { file: h[1], place: h[2] ? `:${h[2]}` : "" };
      continue;
    }
    const under = t.match(UNDER);
    if (under && header) {
      add(header.file, header.place, under[1] ?? under[2] ?? under[3]);
      continue;
    }
    const lead = t.match(LEADING);
    if (lead) add(lead[1], lead[2], lead[3]);
    else if (LOCATION.test(t) || WARNING.test(t) || ERROR.test(t)) add("", "", t);
  }
  if (!groups.size) {
    return { text: lines.slice(-LAST).join("\n"), fallback: true, capped: false, located: 0 };
  }
  const out = [...groups.values()].map(({ file, places, message, count }) => {
    if (!file) return count > 1 ? `${message} (×${count})` : message;
    const shown = places.slice(0, PLACES).join(", ");
    const more = places.length > PLACES ? `, +${places.length - PLACES} more` : "";
    const times = count > Math.max(places.length, 1) ? ` (×${count})` : "";
    return `${file}${shown}${more}: ${message}${times}`;
  });
  const text = cap(out);
  return { text, fallback: false, capped: out.length > FAILURE_MAX, located: [...groups.values()].filter((g) => g.file).length };
}

/**
 * The diagnostics of a check or a warning: each line with a location, a warning or an error, once, with its count.
 * No summary lines, no context lines. The last LAST lines when no line matches. At most FAILURE_MAX lines.
 * Kept for released extensions; diagnose() groups places and joins location lines.
 */
export function diagnostics(output: string): string {
  const lines = clean(output);
  const seen = new Map<string, number>();
  for (const l of lines) {
    const t = l.trim();
    if (!t || SUMMARY.test(t) || NO_WARNING.test(t) || COUNT.test(t)) continue;
    if (LOCATION.test(t) || WARNING_ANY.test(t) || ERROR.test(t)) seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  if (!seen.size) return cap(lines.slice(-LAST));
  return cap([...seen].map(([l, n]) => (n > 1 ? `${l} (×${n})` : l)));
}
