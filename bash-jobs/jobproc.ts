import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { NO_TIME_LIMIT } from "./guard.ts";
import { shorten } from "../shared/store.ts";
import { age, commandLine } from "../shared/util.ts";

export const SMALL_BYTES = 2000;
export const SMALL_LINES = 40;
const ERROR_TAIL_LINES = 20;
const ERROR_TAIL_BYTES = 4096;

export type Job = {
  id: string;
  command: string;
  log: string;
  meta: string;
  pid?: number;
  start: number;
  bg: boolean;
  group?: string;
  result?: string;
  endedAt?: number;
  stats: () => { lines: number; bytes: number };
};

export type Meta = { id: string; command: string; log: string; status: string; pid?: number; start: number; limit: number; bg: boolean; group?: string; reported: boolean };

export const DEFAULT_LIMIT_S = 3600;

export const WRAPPER = `
bash -c "$1" &
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

export function summarize(log: string, status: string, ok: boolean): string {
  const { lines, bytes } = statsOf(log);
  if (bytes <= SMALL_BYTES && lines >= 0 && lines <= SMALL_LINES) return bytes ? `${status}\n${readFileSync(log, "utf8").trimEnd()}` : status;
  let out = `${status} · ${lines < 0 ? "" : `${lines} lines, `}${bytes} bytes · log: ${shorten(log)}`;
  if (!ok) {
    const tail = readFileSync(log, "utf8").slice(-ERROR_TAIL_BYTES).trimEnd().split("\n").slice(-ERROR_TAIL_LINES).join("\n");
    out += `\nlog (last ${ERROR_TAIL_LINES} lines):\n${tail}`;
  }
  return out;
}

export function summarizeFromDisk(m: Meta): string {
  const code = existsSync(m.status) ? readFileSync(m.status, "utf8").trim() : undefined;
  const timedOut = code === undefined && m.limit > 0 && Date.now() >= m.start + m.limit * 1000;
  const status = code !== undefined ? `exit ${code}` : timedOut ? limitText(m.limit) : "ended, exit status unknown (pi stopped while it ran)";
  return summarize(m.log, status, code === "0");
}

export const ending = (job: Job) => (job.result ? job.result.split("\n")[0].split(" · ")[0] : undefined);

export function describe(job: Job): string {
  const { lines, bytes } = job.stats();
  const state = ending(job) ?? `running ${age(Date.now() - job.start)}`;
  return `job ${job.id} · ${state} · ${lines < 0 ? "" : `${lines} lines, `}${bytes} bytes · ${commandLine(job.command, 60)} · log: ${shorten(job.log)}`;
}
