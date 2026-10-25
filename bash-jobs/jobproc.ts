import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { shorten } from "../shared/store.ts";
import { age, commandLine } from "../shared/util.ts";
import { DEFAULT_COLUMNS, DEFAULT_LIMIT_S, DEFAULT_ROWS, ERROR_BYTES, ERROR_LINES, HEAD_BYTES, HEAD_LINES, MAX_BYTES, MAX_LINES, NO_TIME_LIMIT, RESULT_TAIL_BYTES } from "./config.ts";
import { Screen, stripScript } from "./screen.ts";

export type Job = {
  id: string;
  command: string;
  log: string;
  meta: string;
  toolCallId?: string;
  pid?: number;
  start: number;
  bg: boolean;
  group?: string;
  result?: string;
  ok?: boolean;
  endedAt?: number;
  stats: () => { lines: number; bytes: number };
};

export type Meta = {
  id: string;
  command: string;
  log: string;
  status: string;
  pid?: number;
  start: number;
  limit: number;
  bg: boolean;
  group?: string;
  reported: boolean;
};

export type Rendered = { lines: string[]; plain: string[]; cut: boolean };

const WRAPPER = `
SHELL="$BASH" script -q -e -f -E never -O "$4" -c "stty cols $5 rows $6 2>/dev/null; exec bash --norc '$1'" </dev/null >/dev/null 2>&1 &
c=$!
if [ "$3" -gt 0 ]; then
  ( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep "$3" & s=$!; wait $s; kill -TERM -- -$$ ) &
  w=$!
fi
wait $c; code=$?
[ -n "$w" ] && kill $w 2>/dev/null
echo $code > "$2"
exit $code
`;

export function terminalSize(): { columns: number; rows: number } {
  return { columns: process.stdout.columns || DEFAULT_COLUMNS, rows: process.stdout.rows || DEFAULT_ROWS };
}

export function spawnJob(args: { commandFile: string; status: string; limit: number; log: string; cwd: string }): ChildProcess {
  const { columns, rows } = terminalSize();
  return spawn("bash", ["-c", WRAPPER, "bash", args.commandFile, args.status, String(args.limit), args.log, String(columns), String(rows)], {
    cwd: args.cwd,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, COLUMNS: String(columns), LINES: String(rows), TERM: process.env.TERM ?? "xterm-256color" },
  });
}

export const limitText = (limit: number) =>
  `killed at the time limit of ${limit}s${limit === DEFAULT_LIMIT_S ? `; add "${NO_TIME_LIMIT}" to the command to run longer` : ""}`;

export function saveMeta(path: string, m: Meta) {
  writeFileSync(`${path}.${process.pid}`, JSON.stringify(m));
  renameSync(`${path}.${process.pid}`, path);
}

export function alive(pid?: number): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === "ESRCH") return false;
    throw err;
  }
}

export function kill(pid?: number) {
  if (!alive(pid)) return;
  try {
    process.kill(-pid!, "SIGTERM");
  } catch (err: any) {
    if (err.code !== "ESRCH") throw err;
  }
}

export function statsOf(log: string): { lines: number; bytes: number } {
  const bytes = existsSync(log) ? statSync(log).size : 0;
  if (bytes > 1_000_000) return { lines: -1, bytes };
  return { lines: bytes ? (readFileSync(log, "utf8").match(/\n/g) ?? []).length : 0, bytes };
}

export function readTail(log: string, maxBytes: number): { text: string; cut: boolean } {
  if (!existsSync(log)) return { text: "", cut: false };
  const size = statSync(log).size;
  const from = Math.max(0, size - maxBytes);
  const buf = Buffer.alloc(size - from);
  const fd = openSync(log, "r");
  try {
    readSync(fd, buf, 0, buf.length, from);
  } finally {
    closeSync(fd);
  }
  let text = buf.toString("utf8");
  if (from > 0) text = text.slice(text.indexOf("\n") + 1);
  return { text, cut: from > 0 };
}

export function render(log: string, maxBytes: number): Rendered {
  const { text, cut } = readTail(log, maxBytes);
  const screen = new Screen();
  screen.feed(stripScript(text).body);
  const lines = screen.lines();
  const plain = screen.plain();
  if (plain.length && plain[plain.length - 1] === "") {
    lines.pop();
    plain.pop();
  }
  return { lines, plain, cut };
}

export function tailLimit(lines: string[], maxLines: number, maxBytes: number): { kept: string[]; truncated: boolean } {
  let bytes = 0;
  let from = lines.length;
  while (from > 0 && from > lines.length - maxLines) {
    const next = bytes + Buffer.byteLength(lines[from - 1]) + 1;
    if (next > maxBytes) break;
    bytes = next;
    from--;
  }
  return { kept: lines.slice(from), truncated: from > 0 };
}

export function headLimit(lines: string[], maxLines: number, maxBytes: number): string[] {
  let bytes = 0;
  let to = 0;
  while (to < lines.length && to < maxLines) {
    const next = bytes + Buffer.byteLength(lines[to]) + 1;
    if (next > maxBytes) break;
    bytes = next;
    to++;
  }
  return lines.slice(0, to);
}

export const ERROR_PATTERN = /\b(error|errors|fail|failed|failure|failures|fatal|panic|panicked|exception|traceback|denied|not found|cannot|unable|unexpected|invalid|refused|timed out|timeout)\b|✗|\bE\d{3,}\b|^\s*at\s+\S+\s+\(/i;

export function errorLines(lines: string[], from: number, to: number, maxLines: number, maxBytes: number): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (let i = from; i < to && out.length < maxLines; i++) {
    const text = lines[i].trim();
    if (!text || !ERROR_PATTERN.test(text) || seen.has(text)) continue;
    const next = bytes + Buffer.byteLength(text) + 8;
    if (next > maxBytes) break;
    bytes = next;
    seen.add(text);
    out.push({ n: i + 1, text });
  }
  return out;
}

export type Digest = { head: string[]; errors: { n: number; text: string }[]; tail: string[]; hidden: number; truncated: boolean };

export function digest(lines: string[], maxLines = MAX_LINES, maxBytes = MAX_BYTES): Digest {
  const whole = tailLimit(lines, maxLines, maxBytes);
  if (!whole.truncated) return { head: [], errors: [], tail: whole.kept, hidden: 0, truncated: false };
  const head = headLimit(lines, HEAD_LINES, HEAD_BYTES);
  const headBytes = head.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
  const tail = tailLimit(lines, maxLines - head.length, maxBytes - headBytes - ERROR_BYTES).kept;
  const middleEnd = lines.length - tail.length;
  const errors = errorLines(lines, head.length, middleEnd, ERROR_LINES, ERROR_BYTES);
  return { head, errors, tail, hidden: middleEnd - head.length, truncated: true };
}

export function resultText(log: string, status: string): string {
  const { plain, cut } = render(log, RESULT_TAIL_BYTES);
  const d = digest(plain);
  if (!d.truncated && !cut) return d.tail.length ? `${status}\n${d.tail.join("\n")}` : status;
  const txt = log.replace(/\.log$/, ".txt");
  writeFileSync(txt, `${plain.join("\n")}\n`);
  const { bytes } = statsOf(log);
  const total = cut ? `last ${plain.length} lines of ${bytes} bytes` : `${plain.length} lines, ${bytes} bytes`;
  const parts = [`${status} · ${total} · output: ${shorten(txt)}`];
  if (d.head.length) parts.push(`first ${d.head.length} lines:`, ...d.head);
  if (d.hidden > 0) {
    const note = d.errors.length ? ` · ${d.errors.length} of them look like errors (line: text):` : "";
    parts.push(`… ${d.hidden} lines not shown${note}`, ...d.errors.map((e) => `  ${e.n}: ${e.text}`));
  }
  parts.push(`last ${d.tail.length} lines:`, ...d.tail);
  return parts.join("\n");
}

export function summarizeFromDisk(m: Meta): string {
  let code = existsSync(m.status) ? readFileSync(m.status, "utf8").trim() : undefined;
  if (code === undefined) {
    const footer = stripScript(readTail(m.log, 4096).text).exitCode;
    if (footer !== undefined) code = String(footer);
  }
  const timedOut = code === undefined && m.limit > 0 && Date.now() >= m.start + m.limit * 1000;
  const status =
    code !== undefined ? `exit ${code}` : timedOut ? limitText(m.limit) : "ended, exit status unknown (pi stopped while it ran)";
  return resultText(m.log, status);
}

export const ending = (job: Job) => (job.result ? job.result.split("\n")[0].split(" · ")[0] : undefined);

export function describe(job: Job): string {
  const { lines, bytes } = job.stats();
  const state = ending(job) ?? `running ${age(Date.now() - job.start)}`;
  return `job ${job.id} · ${state} · ${lines < 0 ? "" : `${lines} lines, `}${bytes} bytes · ${commandLine(job.command, 60)} · log: ${shorten(job.log)}`;
}
