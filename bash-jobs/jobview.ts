import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { age } from "../shared/util.ts";

const TAIL_BYTES = 4_000_000;
const REFRESH_MS = 500;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const HEIGHT_SHARE = 0.6;
const COMMAND_LINES = 4;

export type ViewJob = { id: string; command: string; log: string; start: number; state: () => string };

function tail(path: string): string[] {
  if (!existsSync(path)) return ["(no output yet)"];
  const size = statSync(path).size;
  const from = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - from);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, from);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString("utf8").replace(ANSI, "").replace(/\r(?!\n)/g, "\n").replace(/\t/g, "  ").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (from > 0) lines[0] = `(first ${Math.round(from / 1024)} KB not shown)`;
  return lines;
}

export class JobLogView {
  private follow = true;
  private top = 0;
  private timer: ReturnType<typeof setInterval>;
  private lines: string[] = [];
  private bodyHeight = 5;

  constructor(
    private job: ViewJob,
    private tui: any,
    private theme: any,
    private done: () => void,
  ) {
    this.lines = tail(job.log);
    this.timer = setInterval(() => {
      this.lines = tail(job.log);
      this.tui.requestRender();
    }, REFRESH_MS);
  }

  handleInput(data: string): void {
    const h = this.bodyHeight;
    const max = Math.max(0, this.lines.length - h);
    const from = this.follow ? max : this.top;
    if (matchesKey(data, "escape") || data === "q") {
      clearInterval(this.timer);
      this.done();
      return;
    }
    if (matchesKey(data, "end")) this.follow = true;
    else if (matchesKey(data, "up")) this.scroll(from - 1, max);
    else if (matchesKey(data, "down")) this.scroll(from + 1, max);
    else if (matchesKey(data, "pageUp")) this.scroll(from - h, max);
    else if (matchesKey(data, "pageDown")) this.scroll(from + h, max);
    else if (matchesKey(data, "home")) this.scroll(0, max);
    this.tui.requestRender();
  }

  private scroll(to: number, max: number) {
    this.top = Math.min(max, Math.max(0, to));
    this.follow = this.top >= max;
  }

  private command(width: number): string[] {
    const wrapped = `$ ${this.job.command.trim()}`.split("\n").flatMap((line) => wrapTextWithAnsi(line, width));
    const shown = wrapped.slice(0, COMMAND_LINES);
    if (wrapped.length > COMMAND_LINES) shown[COMMAND_LINES - 1] = truncateToWidth(`${shown[COMMAND_LINES - 1]} …`, width, "…");
    return shown.map((line) => this.theme.fg("accent", line));
  }

  render(width: number): string[] {
    const cut = (s: string) => truncateToWidth(s, width, "…");
    const command = this.command(width);
    const total = Math.max(8, Math.floor((process.stdout.rows || 40) * HEIGHT_SHARE));
    const h = (this.bodyHeight = Math.max(3, total - command.length - 3));
    const max = Math.max(0, this.lines.length - h);
    const from = this.follow ? max : Math.min(this.top, max);
    const head = `job ${this.job.id} · ${this.job.state()} · ${age(Date.now() - this.job.start)}`;
    const body = this.lines.slice(from, from + h).map(cut);
    while (body.length < h) body.push("");
    const foot = `${from + 1}-${Math.min(from + h, this.lines.length)} of ${this.lines.length} · ${this.follow ? "live" : "scrolled"} · ↑↓ PgUp PgDn End · q close`;
    return [this.theme.bold(cut(head)), ...command, this.theme.fg("dim", "─".repeat(width)), ...body, this.theme.fg("dim", cut(foot))];
  }

  invalidate(): void {}
}
