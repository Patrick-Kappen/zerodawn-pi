import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { age, commandLine } from "../shared/util.ts";
import { ENDED_MS, STREAM_TAIL_BYTES, TAIL_ROWS } from "./config.ts";
import { ICON_HEADER, STATUS, toolIcon } from "./icons.ts";
import { ending, type Job, render } from "./jobproc.ts";
import { view } from "./jobview.ts";
import type { State } from "./state.ts";

const KEY = "tools";
const SHORTCUT = "alt+h";
const TICK_MS = 250;
const SUMMARY_MAX = 60;

export type Widget = { refresh: () => void; stop: () => void };

type Call = { id: string; parent?: string; tool: string; summary: string; start: number; end?: number; ok?: boolean; background?: boolean };
type Row = { text: string; job?: Job };

const ARG_KEYS = ["command", "path", "pattern", "query", "url", "task", "code", "action"];

export function argSummary(tool: string, args: unknown): string {
  if (args === null || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const key = ARG_KEYS.find((k) => typeof record[k] === "string");
  if (!key) return "";
  const raw = commandLine(record[key] as string, SUMMARY_MAX).trim();
  return raw.startsWith(`${homedir()}/`) ? `~${raw.slice(homedir().length)}` : raw;
}

export function createDashboard(pi: ExtensionAPI, s: State): Widget {
  const calls = new Map<string, Call>();
  const counted = new Set<string>();
  let counts = { done: 0, failed: 0 };
  let turnStart = 0;
  let turnEnd: number | undefined;
  let expanded = true;
  let mounted: unknown;
  let tui: { requestRender: () => void } | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const jobOf = (call: Call) => [...s.jobs.values()].find((j) => j.toolCallId === call.id);
  const bgJobs = () => [...s.jobs.values()].filter((j) => j.bg);
  const runningJobs = () => bgJobs().filter((j) => !j.result);
  const recent = (end: number | undefined) => end !== undefined && Date.now() - end < ENDED_MS;

  const countJobs = () => {
    for (const j of bgJobs()) {
      if (!j.result || counted.has(j.id)) continue;
      counted.add(j.id);
      if (j.ok) counts.done++;
      else counts.failed++;
    }
  };

  const anythingRunning = () => [...calls.values()].some((c) => c.end === undefined) || runningJobs().length > 0;
  const anythingRecent = () => [...calls.values()].some((c) => recent(c.end)) || bgJobs().some((j) => recent(j.endedAt));
  const visible = () => calls.size > 0 || bgJobs().length > 0 || counts.done + counts.failed > 0;

  const prune = () => {
    for (const [id, c] of calls) if (c.end !== undefined && !recent(c.end)) calls.delete(id);
  };

  const tick = () => {
    if (!anythingRunning() && !anythingRecent()) {
      clearInterval(ticker);
      ticker = undefined;
    }
    prune();
    tui?.requestRender();
  };

  const header = (theme: any, width: number): string => {
    const running = [...calls.values()].filter((c) => c.end === undefined && !c.parent).length + runningJobs().length;
    const elapsed = turnStart ? age((turnEnd ?? Date.now()) - turnStart) : "";
    const parts = [
      theme.fg("accent", `${STATUS.running} ${running} running`),
      theme.fg("success", `${STATUS.done} ${counts.done} done`),
      counts.failed ? theme.fg("error", `${STATUS.failed} ${counts.failed} failed`) : "",
      elapsed ? theme.fg("dim", elapsed) : "",
    ].filter(Boolean);
    const left = `${theme.fg("accent", ICON_HEADER)} ${theme.bold("Tools")}  ${parts.join(theme.fg("dim", " · "))}`;
    const hint = theme.fg("dim", `${SHORTCUT}${expanded ? "" : " · expand"}`);
    const fill = width - visibleWidth(left) - visibleWidth(hint) - 1;
    return fill > 1 ? `${left}${" ".repeat(fill)}${hint}` : truncateToWidth(left, width, "…");
  };

  const callRow = (theme: any, c: Call, job: Job | undefined, width: number, depth: number): Row => {
    const done = c.end !== undefined;
    const status = !done ? theme.fg("accent", STATUS.running) : c.ok ? theme.fg("success", STATUS.done) : theme.fg("error", STATUS.failed);
    const right = !done ? theme.fg("dim", age(Date.now() - c.start)) : theme.fg("dim", `${c.ok ? "done" : "failed"} · ${age(c.end! - c.start)}`);
    return row(theme, width, depth, status, c.tool, c.summary, right, job);
  };

  const jobRow = (theme: any, j: Job, width: number): Row => {
    const done = j.result !== undefined;
    const status = !done ? theme.fg("accent", STATUS.running) : j.ok ? theme.fg("success", STATUS.done) : theme.fg("error", STATUS.failed);
    const right = !done
      ? `${theme.fg("dim", age(Date.now() - j.start))} ${theme.fg("warning", `${STATUS.background}bg`)}`
      : theme.fg("dim", `${ending(j)} ${STATUS.background}bg`);
    return row(theme, width, 0, status, "bash", commandLine(j.command, SUMMARY_MAX).trim(), right, j);
  };

  const row = (theme: any, width: number, depth: number, status: string, tool: string, summary: string, right: string, job?: Job): Row => {
    const head = `${"  ".repeat(depth)}${status} ${theme.fg("muted", toolIcon(tool))} ${theme.fg("toolTitle", tool.padEnd(8))} `;
    const room = Math.max(1, width - visibleWidth(head) - visibleWidth(right) - 2);
    const text = `${head}${theme.fg("accent", truncateToWidth(summary, room, "…"))}`;
    const fill = width - visibleWidth(text) - visibleWidth(right);
    return { text: fill > 0 ? `${text}${" ".repeat(fill)}${right}` : truncateToWidth(text, width, "…"), job };
  };

  const tailRows = (theme: any, job: Job, width: number): Row[] =>
    render(job.log, STREAM_TAIL_BYTES)
      .lines.slice(-TAIL_ROWS)
      .map((line) => ({ text: truncateToWidth(`      ${theme.fg("dim", "│")} ${line}`, width, "…"), job }));

  const rows = (theme: any, width: number): Row[] => {
    const out: Row[] = [];
    const top = [...calls.values()].filter((c) => !c.parent).sort((a, b) => a.start - b.start);
    for (const c of top) {
      const job = c.tool === "bash" ? jobOf(c) : undefined;
      if (job?.bg) continue;
      out.push(callRow(theme, c, job, width, 0));
      if (job && c.end === undefined) out.push(...tailRows(theme, job, width));
      for (const n of [...calls.values()].filter((x) => x.parent === c.id).sort((a, b) => a.start - b.start)) out.push(callRow(theme, n, undefined, width, 1));
    }
    for (const j of bgJobs().filter((j) => !j.result || recent(j.endedAt)).sort((a, b) => a.start - b.start)) {
      out.push(jobRow(theme, j, width));
      if (!j.result) out.push(...tailRows(theme, j, width));
    }
    return out;
  };

  const refresh = () => {
    countJobs();
    if (!s.ui) return;
    if (!visible()) {
      if (mounted) (s.ui as any).setWidget(KEY, undefined, { placement: "aboveEditor" });
      mounted = tui = undefined;
      return;
    }
    if ((anythingRunning() || anythingRecent()) && !ticker) ticker = setInterval(tick, TICK_MS);
    if (mounted === s.ui) return tui?.requestRender();
    mounted = s.ui;
    let shown: Row[] = [];
    (s.ui as any).setWidget(
      KEY,
      (t: any, theme: any) => {
        tui = t;
        return {
          render(width: number) {
            prune();
            shown = expanded ? rows(theme, width) : [];
            return [truncateToWidth(header(theme, width), width, "…"), ...shown.map((r) => r.text)];
          },
          handleMouse(event: any) {
            if (event.type !== "click" || event.button !== "left") return undefined;
            if (event.y === 0) {
              expanded = !expanded;
              tui?.requestRender();
              return { handled: true };
            }
            const r = shown[event.y - 1];
            if (!r?.job) return undefined;
            void view(s.ui, r.job);
            return { handled: true };
          },
          invalidate() {},
        };
      },
      { placement: "aboveEditor" },
    );
  };

  const stop = () => {
    clearInterval(ticker);
    ticker = mounted = tui = undefined;
  };

  pi.registerShortcut(SHORTCUT, {
    description: "Expand or collapse the tools dashboard",
    handler: () => {
      expanded = !expanded;
      refresh();
    },
  });

  pi.on("session_start", (_event, ctx) => {
    s.ui = ctx.ui;
    refresh();
  });
  pi.on("agent_start", (_event, ctx) => {
    s.ui = ctx.ui;
    calls.clear();
    counts = { done: 0, failed: 0 };
    turnStart = Date.now();
    turnEnd = undefined;
    refresh();
  });
  pi.on("agent_end", () => {
    turnEnd = Date.now();
    refresh();
  });
  pi.on("tool_execution_start", (event) => {
    calls.set(event.toolCallId, { id: event.toolCallId, parent: event.parentToolCallId, tool: event.toolName, summary: argSummary(event.toolName, event.args), start: Date.now() });
    refresh();
  });
  pi.on("tool_execution_end", (event) => {
    const c = calls.get(event.toolCallId);
    if (!c) return;
    c.end = Date.now();
    c.ok = !event.isError;
    c.background = (event.result as { details?: { background?: boolean } } | undefined)?.details?.background === true;
    if (!c.parent && !c.background) {
      if (c.ok) counts.done++;
      else counts.failed++;
    }
    refresh();
  });
  pi.on("session_shutdown", stop);

  return { refresh, stop };
}
