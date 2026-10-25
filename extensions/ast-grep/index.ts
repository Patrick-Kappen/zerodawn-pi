import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { config } from "../../shared/config.ts";
import { format, type Match, plural } from "./format.ts";

const astGrep = config().astGrep ?? "ast-grep";
const maxBuffer = 64 * 1024 * 1024;

interface Details {
  matches: number;
  files: number;
  fullOutputPath?: string;
}

const Params = Type.Object({
  pattern: Type.String({
    description:
      "ast-grep pattern written as code in the target language. $NAME matches one node, $$$ matches zero or more nodes. Example: 'console.log($$$)'.",
  }),
  lang: Type.String({
    description: "Language of the pattern: ts, tsx, js, jsx, nix, py, rust, go, bash, json, yaml, html, css, java, c, cpp, lua.",
  }),
  path: Type.Optional(Type.String({ description: "File or directory to search. Default: current directory. Keep it narrow." })),
  globs: Type.Optional(Type.Array(Type.String(), { description: "Include or exclude globs, for example ['src/**', '!**/*.test.ts']." })),
  rewrite: Type.Optional(
    Type.String({ description: "Preview a rewrite with the captured metavariables, for example 'logger.info($$$)'. Never writes files." }),
  ),
});

function run(args: string[], cwd: string, signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(astGrep, args, { cwd, signal, maxBuffer, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error && typeof (error as NodeJS.ErrnoException).code !== "number") return reject(error);
      resolve({ code: error ? Number((error as NodeJS.ErrnoException).code) : 0, stdout, stderr });
    });
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ast_grep",
    label: "ast-grep",
    description: `Structural code search with ast-grep. Matches syntax tree patterns, not text. Read-only: rewrite is a preview. Output: matches grouped per file as 'line: first line of match'. Truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; the full output is then saved to a temp file.`,
    promptSnippet: "Structural code search (calls, imports, function and class shapes) with ast-grep",
    promptGuidelines: [
      "Use ast_grep to find code by structure: calls, imports, function or class shapes, argument patterns. Use grep for plain text, strings, comments, config and file names.",
      "Always set lang and a narrow path. Search the smallest directory that can contain the answer.",
      "Write the pattern as valid code in the target language. Use $NAME for one node and $$$ for many nodes.",
      "If ast_grep returns a pattern warning or no matches, simplify the pattern before you widen the path.",
      "Use rewrite only to preview a change. Apply changes with the edit tool.",
    ],
    parameters: Params,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const args = ["run", "--pattern", params.pattern, "--lang", params.lang, "--json=stream", "--color=never"];
      for (const glob of params.globs ?? []) args.push("--globs", glob);
      if (params.rewrite !== undefined) args.push("--rewrite", params.rewrite);
      args.push("--", params.path ?? ".");

      const { code, stdout, stderr } = await run(args, ctx.cwd, signal);
      const warning = stderr.trim();
      if (code > 1) throw new Error(warning || `ast-grep exited with code ${code}`);

      const matches = stdout
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Match);

      if (matches.length === 0) {
        const text = warning ? `No matches.\n${warning}` : "No matches.";
        return { content: [{ type: "text", text }], details: { matches: 0, files: 0 } satisfies Details };
      }

      const full = format(matches);
      const files = new Set(matches.map((match) => match.file)).size;
      const details: Details = { matches: matches.length, files };
      const truncation = truncateHead(full, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

      let text = `${plural(matches.length, "match")} in ${plural(files, "file")}\n${truncation.content}`;
      if (truncation.truncated) {
        const dir = await mkdtemp(join(tmpdir(), "pi-ast-grep-"));
        details.fullOutputPath = join(dir, "output.txt");
        await writeFile(details.fullOutputPath, full, "utf8");
        text += `\n\n[Truncated: ${truncation.outputLines} of ${truncation.totalLines} lines. Full output: ${details.fullOutputPath}. Narrow path or globs instead of reading it all.]`;
      }
      if (warning) text += `\n\n${warning}`;

      return { content: [{ type: "text", text }], details };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("ast-grep ")) + theme.fg("accent", args.pattern);
      text += theme.fg("muted", ` [${args.lang}]`);
      if (args.path) text += theme.fg("muted", ` in ${args.path}`);
      if (args.rewrite !== undefined) text += theme.fg("dim", ` → ${args.rewrite}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
      const details = result.details as Details | undefined;
      if (!details?.matches) return new Text(theme.fg("dim", "No matches"), 0, 0);
      let text = theme.fg("success", `${plural(details.matches, "match")} in ${plural(details.files, "file")}`);
      if (details.fullOutputPath) text += theme.fg("warning", " (truncated)");
      if (expanded) {
        const content = result.content[0];
        if (content?.type === "text") text += `\n${theme.fg("dim", content.text.split("\n").slice(1, 41).join("\n"))}`;
      }
      return new Text(text, 0, 0);
    },
  });
}
