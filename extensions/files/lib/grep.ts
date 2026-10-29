import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveOutRef } from "../../../shared/store.ts";
import { absolutePath } from "../../../shared/util.ts";

export const GREP_LINE_MAX = 200;
export const GREP_LIMIT = 100;
export const GREP_PER_FILE = 20;

const schema = Type.Object({
  pattern: Type.String({ description: "Regex, or plain text with literal." }),
  path: Type.Optional(Type.String({ description: "File, directory, or out:<name> for a tool output. Default: current directory." })),
  glob: Type.Optional(Type.String({ description: "For example '*.ts' or '!**/*.test.ts'." })),
  type: Type.Optional(Type.String({ description: "rg file type, for example ts, py, nix." })),
  ignoreCase: Type.Optional(Type.Boolean()),
  literal: Type.Optional(Type.Boolean()),
  multiline: Type.Optional(Type.Boolean({ description: "The pattern can match across lines." })),
  noIgnore: Type.Optional(Type.Boolean({ description: "Also search ignored paths such as node_modules and dist." })),
  filesOnly: Type.Optional(Type.Boolean({ description: "Only the paths with a match, for an overview." })),
  count: Type.Optional(Type.Boolean({ description: "Matching lines per file, for an overview." })),
  context: Type.Optional(Type.Number({ description: "Lines before and after each match." })),
  limit: Type.Optional(Type.Number({ description: `Max result lines. Default: ${GREP_LIMIT}.` })),
});

export type Params = {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  multiline?: boolean;
  noIgnore?: boolean;
  filesOnly?: boolean;
  count?: boolean;
  context?: number;
  limit?: number;
};

export function rgArgs(p: Params, isDir: boolean): string[] {
  if (p.filesOnly && p.count) throw new Error("grep: use filesOnly or count, not both.");
  const args = ["--no-config", "--hidden", "--glob", "!.git", "--sort", "path", "--color", "never", "--line-number", "--with-filename"];
  if (p.filesOnly) args.push("--files-with-matches");
  else if (p.count) args.push("--count");
  else args.push("--json");
  if (isDir && !p.filesOnly && !p.count) args.push("--max-count", String(GREP_PER_FILE));
  if (p.ignoreCase) args.push("--ignore-case");
  if (p.literal) args.push("--fixed-strings");
  if (p.multiline) args.push("--multiline");
  if (p.noIgnore) args.push("--no-ignore");
  if (p.glob) args.push("--glob", p.glob);
  if (p.type) args.push("--type", p.type);
  if (p.context && p.context > 0 && !p.filesOnly && !p.count) args.push("--context", String(Math.floor(p.context)));
  return args;
}

// Turns rg --json events into "path:line: text" for matches and "path-line- text" for context lines.
export function jsonLine(line: string, name: (path: string) => string): { text: string; match: boolean; path: string } | undefined {
  const e = JSON.parse(line);
  if (e.type !== "match" && e.type !== "context") return undefined;
  const path = name(e.data.path.text ?? "");
  const text = String(e.data.lines.text ?? "")
    .replace(/\r?\n$/, "")
    .split("\n")[0];
  const sep = e.type === "match" ? ":" : "-";
  return { text: `${path}${sep}${e.data.line_number}${sep} ${text}`, match: e.type === "match", path };
}

/** Cuts each line above GREP_LINE_MAX characters. */
export const cutLines = (text: string) =>
  text
    .split("\n")
    .map((l) => (l.length > GREP_LINE_MAX ? `${l.slice(0, GREP_LINE_MAX)}… [${l.length} chars]` : l))
    .join("\n");

/** Collects the lines of rg output in the form of the grep tool. `cap` drops the matches of a file after that number. */
export class GrepLines {
  readonly out: string[] = [];
  readonly perFile = new Map<string, number>();
  full = false;

  constructor(
    private readonly p: Params,
    private readonly name: (path: string) => string,
    private readonly limit: number,
    private readonly cap?: number,
  ) {}

  /** Adds one line of rg output. False when the limit is reached. */
  take(line: string): boolean {
    if (!line || this.full) return !this.full;
    if (this.p.filesOnly || this.p.count) this.out.push(this.name(line.replace(/:(\d+)$/, "")) + (this.p.count ? `:${line.match(/:(\d+)$/)?.[1]}` : ""));
    else {
      const r = jsonLine(line, this.name);
      if (!r) return true;
      const n = this.perFile.get(r.path) ?? 0;
      if (this.cap !== undefined && n >= this.cap) return true;
      this.out.push(r.text);
      if (r.match) this.perFile.set(r.path, n + 1);
    }
    if (this.out.length >= this.limit) this.full = true;
    return !this.full;
  }

  /** The result text with its notes: limit, files with the max of matches, rg errors. */
  text(isDir: boolean, stderr: string): string {
    if (this.out.length === 0) return "No matches found";
    const notes: string[] = [];
    if (this.full) notes.push(`[Limit of ${this.limit} lines reached. Use a narrower path, glob or type, or a higher limit.]`);
    const capped = [...this.perFile].filter(([, n]) => isDir && n >= GREP_PER_FILE).map(([p]) => p);
    if (capped.length) notes.push(`[Max ${GREP_PER_FILE} matches per file in: ${capped.join(", ")}. Search that file for more.]`);
    if (stderr.trim()) notes.push(`[rg errors: ${stderr.trim().split("\n").slice(0, 3).join("; ")}]`);
    return [this.out.join("\n"), ...notes].join("\n\n");
  }
}

export function registerGrep(pi: ExtensionAPI, cwd: string) {
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: `Find code and text with ripgrep before you read; then read the found range. Returns 'path:line: text' sorted by path. Hidden files are in, .git and .gitignore'd paths are out. Max ${GREP_PER_FILE} matches per file in a directory; lines are cut at ${GREP_LINE_MAX} chars.`,
    promptSnippet: "Search file contents with ripgrep (respects .gitignore; noIgnore for ignored paths)",
    parameters: schema,
    async execute(_id, params: Params, signal, _onUpdate, ctx) {
      const base = ctx?.cwd ?? cwd;
      const target = (params.path && resolveOutRef(ctx, params.path)) || absolutePath(params.path ?? ".", base);
      const stat = statSync(target, { throwIfNoEntry: false });
      if (!stat) throw new Error(`grep: path ${params.path ?? "."} does not exist in ${base}.`);
      const isDir = stat.isDirectory();
      const limit = Math.max(1, Math.floor(params.limit ?? GREP_LIMIT));
      const args = [...rgArgs(params, isDir), "--", params.pattern, target];
      const name = (p: string) => (isDir ? relative(target, p) || p : (params.path ?? p));
      return new Promise((resolve, reject) => {
        const child = spawn("rg", args, { cwd: base, stdio: ["ignore", "pipe", "pipe"], signal });
        const found = new GrepLines(params, name, limit);
        let rest = "";
        let stderr = "";
        const take = (line: string) => {
          if (!found.full && !found.take(line)) child.kill();
        };
        child.stdout.on("data", (chunk: Buffer) => {
          const lines = (rest + chunk.toString()).split("\n");
          rest = lines.pop() ?? "";
          lines.forEach(take);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") reject(new Error("grep: rg (ripgrep) is not on PATH. Install ripgrep.", { cause: err }));
          else reject(new Error(`grep: rg failed in ${base}: ${err.message}`, { cause: err }));
        });
        child.on("close", (code) => {
          take(rest);
          if (!found.full && code !== 0 && code !== 1 && found.out.length === 0)
            return reject(new Error(`grep: rg exited with code ${code}: ${stderr.trim() || "no message"}`));
          resolve({ content: [{ type: "text", text: found.text(isDir, stderr) }], details: undefined });
        });
      });
    },
  });
}
