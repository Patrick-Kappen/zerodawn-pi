import { readFileSync } from "node:fs";
import {
  createEditToolDefinition,
  createGrepToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { explain, fixIndent, freshLines } from "./editfix.ts";
import { absolutePath } from "../shared/util.ts";

export const READ_FULL_MAX = 400;
export const READ_FULL_MAX_CHARS = 16000;
export const READ_LIMIT_MAX = 400;
export const WRITE_MAX_LINES = 100;

export const GREP_DEFAULT_LIMIT = 30;
export const GREP_LINE_MAX = 200;

export function registerBuiltins(pi: ExtensionAPI) {
  const cwd = process.cwd();

  pi.registerTool({
    ...createReadToolDefinition(cwd),
    description: `Read a file. A text file without limit returns up to ${READ_FULL_MAX} lines and ${READ_FULL_MAX_CHARS} chars; a larger file is blocked: grep first, then read a range with offset and limit (max ${READ_LIMIT_MAX} lines). Images (jpg, png, gif, webp, bmp) are sent as attachments.`,
    promptSnippet: "Read a file or a line range",
    promptGuidelines: ["Use read to examine files, not cat, head, tail or sed in bash."],
  });

  const grep = createGrepToolDefinition(cwd);
  const props = (grep.parameters as any).properties;
  pi.registerTool({
    ...grep,
    parameters: {
      ...grep.parameters,
      properties: { ...props, limit: { ...props.limit, description: `Maximum number of matches to return (default: ${GREP_DEFAULT_LIMIT})` } },
    } as typeof grep.parameters,
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Returns ${GREP_DEFAULT_LIMIT} matches unless you set limit; lines are cut at ${GREP_LINE_MAX} chars.`,
    promptSnippet: "Search file contents for patterns (respects .gitignore)",
    promptGuidelines: ["Find code with grep or ast_grep first. Then read the found range with offset and limit."],
  });

  const edit = createEditToolDefinition(cwd);
  pi.registerTool({
    ...edit,
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: ExtensionToolContext) {
      const file = absolutePath(String(params.path), ctx?.cwd ?? cwd);
      const withFresh = (result: any, edits: any[], note?: string) => {
        const fresh = freshLines(readFileSync(file, "utf8"), edits.map((e) => e.newText));
        const extra = [note, fresh].filter(Boolean).map((text) => ({ type: "text" as const, text: `${text}\n` }));
        return { ...result, content: [...(result.content ?? []), ...extra] };
      };
      try {
        const result = await edit.execute(toolCallId, params, signal, onUpdate, ctx);
        return Array.isArray(params.edits) ? withFresh(result, params.edits) : result;
      } catch (err: any) {
        if (!/Could not find/.test(String(err?.message)) || !Array.isArray(params.edits)) throw err;
        let text: string;
        try {
          text = readFileSync(file, "utf8");
        } catch {
          throw err;
        }
        let corrected = 0;
        const problems: string[] = [];
        const edits = params.edits.map((e: any, i: number) => {
          if (text.includes(e.oldText)) return e;
          const fix = fixIndent(text, e.oldText, e.newText);
          if (fix) {
            corrected++;
            return fix;
          }
          problems.push(`edits[${i}]: ${explain(text, e.oldText, e.newText)}`);
          return e;
        });
        if (problems.length) throw new Error(`${err.message}\n${problems.join("\n")}`, { cause: err });
        const result = await edit.execute(toolCallId, { ...params, edits }, signal, onUpdate, ctx);
        return withFresh(result, edits, `Applied with corrected indentation in ${corrected} of ${edits.length} entries.`);
      }
    },
  });

  pi.registerTool({
    ...createWriteToolDefinition(cwd),
    description: `Create a file, or replace a file of up to ${WRITE_MAX_LINES} lines. Creates parent directories. A larger existing file is blocked: use edit, or rm the file with bash first.`,
    promptSnippet: "Create files or replace small files",
    promptGuidelines: ["Use write for new files. Use edit to change an existing file."],
  });
}
