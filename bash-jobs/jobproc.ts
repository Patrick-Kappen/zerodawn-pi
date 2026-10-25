import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { shorten } from "../shared/store.ts";
import { age, commandLine } from "../shared/util.ts";
import { DEFAULT_COLUMNS, DEFAULT_LIMIT_S, DEFAULT_ROWS, MAX_BYTES, MAX_LINES, NO_TIME_LIMIT, RESULT_TAIL_BYTES } from "./config.ts";
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

export function resultText(log: string, status: string): string {
  const { plain, cut } = render(log, RESULT_TAIL_BYTES);
  const { kept, truncated } = tailLimit(plain, MAX_LINES, MAX_BYTES);
  if (!truncated && !cut) return kept.length ? `${status}\n${kept.join("\n")}` : status;
  const { bytes } = statsOf(log);
  const total = cut ? "" : `${plain.length} lines, `;
  return `${status} · ${total}${bytes} bytes · last ${kept.length} lines:\n${kept.join("\n")}\nlog: ${shorten(log)}`;
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
