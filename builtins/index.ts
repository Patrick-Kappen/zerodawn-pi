import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_MAX_LINES, type ExtensionAPI, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { outFile, shorten } from "../shared/store.ts";
import { absolutePath, textOf } from "../shared/util.ts";
import { GREP_LINE_MAX, registerBuiltins, WRITE_MAX_LINES } from "./builtins.ts";

const MAX_BYTES = 16 * 1024;
const WORKFLOW = `A codemode result above ${DEFAULT_MAX_LINES} lines or ${formatSize(MAX_BYTES)} is cut. The full text goes to a log file. Return only the data you need from codemode.`;

export default function (pi: ExtensionAPI) {
  registerBuiltins(pi);

  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections.tool_workflow = WORKFLOW;
  });

  pi.on("tool_call", (event, ctx) => {
    const input = event.input as any;
    if (event.toolName !== "write" || typeof input.path !== "string") return;
    let old: string;
    try {
      old = readFileSync(absolutePath(input.path, ctx.cwd), "utf8");
    } catch (err: any) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    const lines = old.split("\n").length - (old.endsWith("\n") ? 1 : 0);
    if (lines > WRITE_MAX_LINES)
      return {
        block: true,
        reason: `${input.path} exists with ${lines} lines. Use edit for changes. To replace the whole file, rm it with bash first.`,
      };
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName === "grep") {
      const text = textOf(event.content);
      if (text === undefined) return;
      const cut = text
        .split("\n")
        .map((l) => (l.length > GREP_LINE_MAX ? `${l.slice(0, GREP_LINE_MAX)}… [${l.length} chars]` : l))
        .join("\n");
      return cut === text ? undefined : { content: [{ type: "text", text: cut }] };
    }
    if (event.toolName !== "codemode" || event.parentToolCallId) return;
    const text = textOf(event.content);
    if (text === undefined) return;
    const cut = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: MAX_BYTES });
    if (!cut.truncated) return;
    const log = outFile(ctx, event.toolCallId, "codemode");
    writeFileSync(log, text);
    const note = `[codemode result cut: ${cut.outputLines} of ${cut.totalLines} lines, ${formatSize(cut.outputBytes)} of ${formatSize(cut.totalBytes)}. Full text: ${shorten(log)}]`;
    return { content: [{ type: "text", text: `${cut.content}\n\n${note}` }] };
  });
}
