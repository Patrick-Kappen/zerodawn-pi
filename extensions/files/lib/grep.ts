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
  pattern: Type.String({ description: "Search pattern (regex, or literal with literal: true)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search, or out:<name> for a tool output (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '!**/*.test.ts'" })),
  type: Type.Optional(Type.String({ description: "Filter files by rg file type, e.g. ts, py, nix" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
  multiline: Type.Optional(Type.Boolean({ description: "Let the pattern match across lines (default: false)" })),
  noIgnore: Type.Optional(Type.Boolean({ description: "Search files that .gitignore excludes, such as node_modules or dist (default: false)" })),
  filesOnly: Type.Optional(Type.Boolean({ description: "Return only the paths of files with a match" })),
  count: Type.Optional(Type.Boolean({ description: "Return the number of matching lines per file" })),
  context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: `Maximum number of result lines (default: ${GREP_LIMIT})` })),
});

type Params = {
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

export function registerGrep(pi: ExtensionAPI, cwd: string) {
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: `Search file contents with ripgrep. Use it to find code and text before you read; then read the found range with offset and limit. filesOnly or count give an overview first. noIgnore: true also searches node_modules, dist and other ignored paths. Returns matching lines with file paths and line numbers, sorted by path. Searches hidden files, not .git. Respects .gitignore unless noIgnore. Max ${GREP_PER_FILE} matches per file in a directory, ${GREP_LIMIT} lines in total by default. Lines are cut at ${GREP_LINE_MAX} chars.`,
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
        const out: string[] = [];
        const perFile = new Map<string, number>();
        let rest = "";
        let stderr = "";
        let full = false;
        const take = (line: string) => {
          if (!line || full) return;
          if (params.filesOnly || params.count) out.push(name(line.replace(/:(\d+)$/, "")) + (params.count ? `:${line.match(/:(\d+)$/)?.[1]}` : ""));
          else {
            const r = jsonLine(line, name);
            if (!r) return;
            out.push(r.text);
            if (r.match) perFile.set(r.path, (perFile.get(r.path) ?? 0) + 1);
          }
          if (out.length >= limit) {
            full = true;
            child.kill();
          }
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
          if (!full && code !== 0 && code !== 1 && out.length === 0)
            return reject(new Error(`grep: rg exited with code ${code}: ${stderr.trim() || "no message"}`));
          if (out.length === 0) return resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined });
          const notes: string[] = [];
          if (full) notes.push(`[Limit of ${limit} lines reached. Use a narrower path, glob or type, or a higher limit.]`);
          const capped = [...perFile].filter(([, n]) => isDir && n >= GREP_PER_FILE).map(([p]) => p);
          if (capped.length) notes.push(`[Max ${GREP_PER_FILE} matches per file in: ${capped.join(", ")}. Search that file for more.]`);
          if (stderr.trim()) notes.push(`[rg errors: ${stderr.trim().split("\n").slice(0, 3).join("; ")}]`);
          resolve({ content: [{ type: "text", text: [out.join("\n"), ...notes].join("\n\n") }], details: undefined });
        });
      });
    },
  });
}
