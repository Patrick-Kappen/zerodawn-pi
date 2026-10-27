import { readFileSync } from "node:fs";
import { createReadToolDefinition, type ExtensionAPI, type ExtensionToolContext, formatSize } from "@earendil-works/pi-coding-agent";
import { resolveOutRef } from "../../../shared/store.ts";
import { absolutePath } from "../../../shared/util.ts";
import { fileLines, linesInContext, type Seen, type SeenRange, seenRanges, segments } from "./lines.ts";
import { OUTLINE_MAX, outline } from "./outline.ts";

export const READ_MAX_LINES = 200;
export const READ_MAX_BYTES = 16 * 1024;
const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;
const BINARY_PROBE = 8000;
const NOTE_BYTES = 100;

type Range = [number, number];
const list = (ranges: Range[]) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");

export function renderRead(
  name: string,
  lines: string[],
  offset: number | undefined,
  limit: number | undefined,
  inContext: Set<number>,
): { text: string; shown: Range[] } {
  const total = lines.length;
  if (total === 0) return { text: `${name} is empty.`, shown: [] };
  if (limit !== undefined && limit < 1) throw new Error(`read: limit ${limit} for ${name} is below 1. Give a limit of 1 to ${READ_MAX_LINES}.`);
  if (offset === undefined && limit === undefined && total > READ_MAX_LINES) {
    const map = outline(name, lines);
    if (map.entries.length) {
      const cut = map.cut ? `\n[Outline cut at ${OUTLINE_MAX} entries.]` : "";
      return {
        text: `${name}: ${total} lines. Outline (line: text):\n${map.entries.join("\n")}${cut}\n[Read a range with offset and limit (max ${READ_MAX_LINES} lines), or grep for the lines you need.]`,
        shown: [],
      };
    }
  }
  const from = offset === undefined || offset === 0 ? 1 : offset < 0 ? Math.max(1, total + offset + 1) : offset;
  if (from > total)
    throw new Error(`read: offset ${offset} is beyond the end of ${name} (${total} lines). Use a lower offset, or offset=-N for the last N lines.`);
  const asked = limit ?? (offset !== undefined && offset < 0 ? -offset : READ_MAX_LINES);
  const to = Math.min(total, from + Math.min(asked, READ_MAX_LINES) - 1);
  const lineSet = (ranges: Range[]) => new Set(ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)));
  // A known part shorter than the note about it costs more context than the lines, so it is sent again.
  const short = segments(from, to, lineSet(segments(from, to, inContext))).filter(([a, b]) => Buffer.byteLength(lines.slice(a - 1, b).join("\n")) < NOTE_BYTES);
  const skip = lineSet(short);
  const missing = segments(from, to, new Set([...inContext].filter((n) => !skip.has(n))));
  if (!missing.length) return { text: `[${name} lines ${from}-${to} are unchanged and already in your context. Use that copy.]`, shown: [] };

  const shown: Range[] = [];
  let bytes = 0;
  let stop: number | undefined;
  for (const [a, b] of missing) {
    let end = a - 1;
    for (let n = a; n <= b; n++) {
      const size = Buffer.byteLength(lines[n - 1]) + 1;
      if (bytes + size > READ_MAX_BYTES) {
        stop = n;
        break;
      }
      bytes += size;
      end = n;
    }
    if (end >= a) shown.push([a, end]);
    if (stop !== undefined) break;
  }
  if (!shown.length) {
    const line = lines[stop! - 1];
    return {
      text: `${line.slice(0, READ_MAX_BYTES)}\n\n[Line ${stop} of ${name} is ${formatSize(Buffer.byteLength(line))}; cut at ${formatSize(READ_MAX_BYTES)}. Use grep to find text in it.]`,
      shown: [],
    };
  }

  const text = (a: number, b: number) => lines.slice(a - 1, b).join("\n");
  const known = segments(from, to, lineSet(missing));
  const one = known.length === 1 && known[0][0] === known[0][1];
  const body =
    known.length === 0 && shown.length === 1
      ? text(...shown[0])
      : [
          `[${one ? "Line" : "Lines"} ${list(known)} ${one ? "is" : "are"} unchanged and already in your context; not sent again.]`,
          ...shown.map(([a, b]) => `[lines ${a}-${b}]\n${text(a, b)}`),
        ].join("\n");
  const last = shown[shown.length - 1][1];
  let note = "";
  if (stop !== undefined) note = `\n\n[Cut at ${formatSize(READ_MAX_BYTES)}. Use offset=${stop} to continue.]`;
  else if (to < total) {
    const capped = asked > READ_MAX_LINES ? `; limit is capped at ${READ_MAX_LINES}` : "";
    note = `\n\n[Showing lines ${from}-${last} of ${total}${capped}. Use offset=${to + 1} to continue.]`;
  }
  return { text: body + note, shown };
}

export function contextRanges(sessionManager: ExtensionToolContext["sessionManager"], file: string): SeenRange[] {
  const out: SeenRange[] = [];
  for (const projected of sessionManager.buildSessionProjection().entries) {
    const entry = projected.sourceEntry as { type: string; message?: { role: string; content?: unknown; details?: { seen?: Seen } } };
    const seen = entry.type === "message" && entry.message?.role === "toolResult" ? entry.message.details?.seen : undefined;
    if (!seen || seen.path !== file) continue;
    const now = projected.messages[0] as { content?: unknown } | undefined;
    if (!now || JSON.stringify(now.content) !== JSON.stringify(entry.message?.content)) continue;
    out.push(...seen.ranges);
  }
  return out;
}

export function seenDetails(file: string, lines: string[], ranges: Range[]): { seen?: Seen } {
  return ranges.length ? { seen: { path: file, ranges: seenRanges(lines, ranges) } } : {};
}

export function registerRead(pi: ExtensionAPI, cwd: string) {
  const base = createReadToolDefinition(cwd);
  pi.registerTool({
    ...base,
    description: `Read a file. Without offset and limit, a file over ${READ_MAX_LINES} lines gives an outline with line numbers. limit is capped at ${READ_MAX_LINES} lines. offset=-N gives the last N lines. Lines that are unchanged and still in your context are not sent again. Images (jpg, png, gif, webp, bmp) are sent as attachments.`,
    promptSnippet: "Read a line range of a file, or the outline of a big file",
    promptGuidelines: [
      "Use read to examine files, not cat, head, tail or sed in bash.",
      "Find the lines with grep or the outline first. Then read only that range.",
      "For the end of a log or an output path, use offset=-N. An output named out:<name> is a path for read and grep.",
    ],
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: ExtensionToolContext) {
      if (IMAGE.test(String(params.path))) return base.execute(toolCallId, params, signal, onUpdate, ctx);
      const file = resolveOutRef(ctx, String(params.path)) ?? absolutePath(String(params.path), ctx?.cwd ?? cwd);
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch (err: any) {
        throw new Error(`read: cannot read ${params.path} (${err.code ?? err.message}). Find the path with grep or ls.`, { cause: err });
      }
      if (raw.slice(0, BINARY_PROBE).includes("\0")) return base.execute(toolCallId, params, signal, onUpdate, ctx);
      const lines = fileLines(raw);
      const result = renderRead(String(params.path), lines, params.offset, params.limit, linesInContext(lines, contextRanges(ctx.sessionManager, file)));
      return { content: [{ type: "text" as const, text: result.text }], details: seenDetails(file, lines, result.shown) as any };
    },
  });
}
