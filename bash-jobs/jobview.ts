import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { shorten } from "../shared/store.ts";
import { age } from "../shared/util.ts";
import { STREAM_TAIL_BYTES, VIEW_TAIL_BYTES } from "./config.ts";
import { STATUS, toolIcon } from "./icons.ts";
import { ending, type Job, render } from "./jobproc.ts";
import type { State } from "./state.ts";

const ENTRY = "bash-follow";
const COLLAPSED_LINES = 40;
const EXPANDED_LINES = 500;
const COMMAND_LINES = 4;

type FollowData = { seq: number; job: string; command: string; log: string; start: number };

export function isFollowed(s: State, job: Job): boolean {
  return s.follow === job.id;
}

export function closeFollow(s: State) {
  s.follow = undefined;
  s.tui?.requestRender();
}

export function toggleFollow(pi: ExtensionAPI, s: State, job: Job) {
  if (isFollowed(s, job)) return closeFollow(s);
  s.follow = job.id;
  if (s.followEntries.has(job.id)) return s.tui?.requestRender();
  const seq = Date.now();
  s.followEntries.set(job.id, seq);
  pi.appendEntry<FollowData>(ENTRY, { seq, job: job.id, command: job.command, log: job.log, start: job.start });
}

class FollowView {
  constructor(
    private data: FollowData,
    private s: State,
    private theme: any,
    private expanded: boolean,
  ) {}

  private open(): boolean {
    return this.s.follow === this.data.job && this.s.followEntries.get(this.data.job) === this.data.seq;
  }

  render(width: number): string[] {
    if (!this.open()) return [];
    const t = this.theme;
    const cut = (line: string) => truncateToWidth(line, width, "…");
    const job = this.s.jobs.get(this.data.job);
    const running = job !== undefined && job.result === undefined;
    const state = job ? (ending(job) ?? (job.bg ? "running in the background" : "running")) : "ended";
    const mark = running ? t.fg("accent", STATUS.running) : job?.ok === false ? t.fg("error", STATUS.failed) : t.fg("success", STATUS.done);
    const elapsed = running ? ` · ${age(Date.now() - this.data.start)}` : "";
    const head = `${mark} ${t.fg("muted", toolIcon("bash"))} ${t.bold(`job ${this.data.job}`)} ${t.fg("dim", `· ${state}${elapsed} · click or ctrl+shift+j closes`)}`;
    const command = this.data.command.trim().split("\n");
    const shownCommand = command.slice(0, COMMAND_LINES).map((line, i) => cut(`  ${t.fg("accent", `${i === 0 ? "$ " : "  "}${line}`)}`));
    if (command.length > COMMAND_LINES) shownCommand.push(t.fg("dim", `    … ${command.length - COMMAND_LINES} more command lines`));
    const out = render(this.data.log, this.expanded ? VIEW_TAIL_BYTES : STREAM_TAIL_BYTES);
    const max = this.expanded ? EXPANDED_LINES : COLLAPSED_LINES;
    const lines = out.lines.slice(-max).map((line) => cut(`  ${t.fg("dim", "│")} ${line}`));
    const hidden = out.lines.length - Math.min(out.lines.length, max);
    const foot: string[] = [];
    if (hidden > 0 || out.cut) foot.push(t.fg("muted", `  … ${hidden > 0 ? `${hidden} more lines` : "earlier output not shown"}${this.expanded ? "" : " · ctrl+o shows more"} · log: ${shorten(this.data.log)}`));
    else if (!out.lines.length) foot.push(t.fg("dim", "  (no output yet)"));
    return [cut(head), ...shownCommand, ...lines, ...foot];
  }

  handleMouse(event: { type: string; button?: string }) {
    if (event.type !== "click" || event.button !== "left" || !this.open()) return undefined;
    closeFollow(this.s);
    return { handled: true };
  }

  invalidate(): void {}
}

export function registerFollowView(pi: ExtensionAPI, s: State) {
  pi.registerEntryRenderer<FollowData>(ENTRY, (entry, { expanded }, theme) => new FollowView(entry.data, s, theme, expanded));
}
