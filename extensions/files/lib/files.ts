import { readFileSync } from "node:fs";
import {
  createEditToolDefinition,
  createGrepToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { config } from "../../../shared/config.ts";
import { absolutePath } from "../../../shared/util.ts";
import { explain, fixIndent, freshLines, freshRanges } from "./editfix.ts";
import { formatterFor, runFormatter } from "./format.ts";
import { fileLines } from "./lines.ts";
import { registerRead, seenDetails } from "./read.ts";
import { type Checker, checked } from "./syntax.ts";

export const WRITE_MAX_LINES = 100;
export const GREP_LINE_MAX = 200;

const fromConfig = (): Checker => ({ nvim: config().nvim ?? "nvim", parsers: config().treesitterParsers });

export function registerFiles(pi: ExtensionAPI, checker: Checker = fromConfig()) {
  const cwd = process.cwd();

  registerRead(pi, cwd);

  pi.registerTool({
    ...createGrepToolDefinition(cwd),
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Lines are cut at ${GREP_LINE_MAX} chars.`,
    promptSnippet: "Search file contents for patterns (respects .gitignore)",
    promptGuidelines: ["Find code with grep or ast_grep first. Then read the found range with offset and limit."],
  });

  const edit = createEditToolDefinition(cwd);
  pi.registerTool({
    ...edit,
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: ExtensionToolContext) {
      const file = absolutePath(String(params.path), ctx?.cwd ?? cwd);
      const name = String(params.path);
      const formatter = formatterFor(file);
      const change = async (edits: unknown) => {
        const result = await checked(checker, file, name, () => edit.execute(toolCallId, { ...params, edits }, signal, onUpdate, ctx));
        return { result, formatted: formatter ? await runFormatter(formatter, file, name) : undefined };
      };
      const withFresh = (result: any, edits: any[], ...notes: (string | undefined)[]) => {
        const note = notes.filter(Boolean).join("\n") || undefined;
        const text = readFileSync(file, "utf8");
        const newTexts = edits.map((e) => e.newText);
        const fresh = freshLines(text, newTexts);
        const extra = [note, fresh].filter(Boolean).map((t) => ({ type: "text" as const, text: `${t}\n` }));
        const details = { ...result.details, ...seenDetails(file, fileLines(text), freshRanges(text, newTexts)) };
        return { ...result, content: [...(result.content ?? []), ...extra], details };
      };
      try {
        const { result, formatted } = await change(params.edits);
        return Array.isArray(params.edits) ? withFresh(result, params.edits, formatted) : result;
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
        const { result, formatted } = await change(edits);
        return withFresh(result, edits, `Applied with corrected indentation in ${corrected} of ${edits.length} entries.`, formatted);
      }
    },
  });

  const write = createWriteToolDefinition(cwd);
  pi.registerTool({
    ...write,
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: ExtensionToolContext) {
      const file = absolutePath(String(params.path), ctx?.cwd ?? cwd);
      const formatter = formatterFor(file);
      const result = await checked(checker, file, String(params.path), () => write.execute(toolCallId, params, signal, onUpdate, ctx));
      const formatted = formatter ? await runFormatter(formatter, file, String(params.path)) : undefined;
      const lines = fileLines(String(params.content));
      const content = formatted ? [...result.content, { type: "text" as const, text: formatted }] : result.content;
      return {
        ...result,
        content,
        details: { ...(result.details as object | undefined), ...seenDetails(file, lines, lines.length ? [[1, lines.length]] : []) },
      } as any;
    },
    description: `Create a file, or replace a file of up to ${WRITE_MAX_LINES} lines. Creates parent directories. A larger existing file is blocked: use edit, or rm the file with bash first.`,
    promptSnippet: "Create files or replace small files",
    promptGuidelines: ["Use write for new files. Use edit to change an existing file."],
  });
}
