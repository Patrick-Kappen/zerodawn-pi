import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { commandLine } from "../shared/util.ts";
import { RESULT_TAIL_BYTES, RESULT_VIEW_LINES, STREAM_LINES } from "./config.ts";
import { STATUS } from "./icons.ts";
import { render } from "./jobproc.ts";
import type { JobReport } from "./jobs.ts";

const PARTIAL_LINES = 5;
const ERROR_LINES = 10;

type Details = { log?: string; job?: string; lines?: string[]; background?: boolean };

function statusLine(theme: any, status: string, ok: boolean): string {
  const mark = ok ? theme.fg("success", STATUS.done) : theme.fg("error", STATUS.failed);
  return `${mark} ${theme.fg(ok ? "dim" : "error", status)}`;
}

function more(theme: any, hidden: number): string[] {
  return hidden > 0 ? [theme.fg("muted", `… ${hidden} more lines · /jobs follows the log`)] : [];
}

export function outputLines(theme: any, log: string | undefined, fallback: string[], max: number): string[] {
  const all = log ? render(log, RESULT_TAIL_BYTES).lines : fallback;
  return [...all.slice(-max), ...more(theme, all.length - max)];
}

export function renderCall(args: { command?: string }, theme: any) {
  const lines = (args.command ?? "").trim().split("\n");
  const extra = lines.length > 1 ? theme.fg("dim", ` (+${lines.length - 1} lines)`) : "";
  return new Text(`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", lines[0] ?? "")}${extra}`, 0, 0);
}

export function renderResult(result: { content: { type: string; text?: string }[]; details?: unknown }, options: { expanded: boolean; isPartial: boolean }, theme: any) {
  const details = (result.details ?? {}) as Details;
  if (options.isPartial) {
    const head = `${theme.fg("accent", `${STATUS.running} running`)}${details.job ? theme.fg("dim", ` · job ${details.job}`) : ""}`;
    const lines = (details.lines ?? []).slice(options.expanded ? -STREAM_LINES : -PARTIAL_LINES);
    return new Text([head, ...lines].join("\n"), 0, 0);
  }
  if (details.background) {
    return new Text(`${theme.fg("warning", `${STATUS.background} job ${details.job} runs in the background`)}${theme.fg("dim", " · a message reports the result")}`, 0, 0);
  }
  const text = result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n")
    .replace(/^Error: /, "");
  const [first = "", ...rest] = text.split("\n");
  const status = first.split(" · ")[0];
  const ok = /^exit 0\b/.test(status);
  const count = rest.filter((l) => !l.startsWith("log: ")).length;
  const head = `${statusLine(theme, status, ok)}${count ? theme.fg("dim", ` · ${count} ${count === 1 ? "line" : "lines"}`) : ""}`;
  if (options.expanded) return new Text([head, ...outputLines(theme, details.log, rest, RESULT_VIEW_LINES)].join("\n"), 0, 0);
  if (!ok) return new Text([head, ...outputLines(theme, details.log, rest, ERROR_LINES)].join("\n"), 0, 0);
  return new Text(head, 0, 0);
}

export function registerMessageRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer("bash-job", (message, { expanded }, theme) => {
    const items = (message.details as JobReport | undefined)?.items ?? [];
    const lines = items.flatMap((it) => {
      const head = `${statusLine(theme, it.status, it.ok)} ${theme.fg("dim", `job ${it.id} ·`)} ${theme.fg("accent", commandLine(it.command, 70).trim())}`;
      return expanded || !it.ok ? [head, ...outputLines(theme, it.log, [], expanded ? RESULT_VIEW_LINES : ERROR_LINES)] : [head];
    });
    return new Text(lines.join("\n"), 0, 0);
  });
}
