import { readFileSync, statSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GREP_DEFAULT_LIMIT, GREP_LINE_MAX, READ_FULL_MAX, READ_FULL_MAX_CHARS, READ_LIMIT_MAX, WRITE_MAX_LINES } from "./builtins.ts";
import { checkBash, waitsOnly } from "./guard.ts";
import { loadRecipes, promptText, type Recipes, Tracker } from "./recipes.ts";
import { hasBackgroundJob, type State } from "./state.ts";
import { outFile, shorten } from "../shared/store.ts";
import { absolutePath } from "../shared/util.ts";

const CODEMODE_INLINE_MAX = 2000;

const WORKFLOW = `A codemode result above ${CODEMODE_INLINE_MAX} chars goes to a log file. Return only the data you need from codemode.`;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

function textOf(content: any[]): string | undefined {
  if (!content.every((c) => c.type === "text")) return undefined;
  return content.map((c) => c.text).join("");
}

export function registerLimits(pi: ExtensionAPI, s: State) {
  let tracker = new Tracker();
  let recipes: Recipes | undefined;
  const hints = new Map<string, string>();
  pi.on("session_start", () => {
    tracker = new Tracker();
  });
  pi.on("before_agent_start", (event, ctx) => {
    tracker.turn();
    recipes = loadRecipes(ctx.cwd);
    event.systemPromptOptions.sections.tool_workflow = recipes ? `${WORKFLOW}\n${promptText(recipes)}` : WORKFLOW;
  });

  pi.on("tool_call", (event, ctx) => {
    const input = event.input as any;
    if (event.toolName === "grep") {
      input.limit ??= GREP_DEFAULT_LIMIT;
      return;
    }
    if (event.toolName === "bash" && typeof input.command === "string") {
      if (hasBackgroundJob(s) && waitsOnly(input.command))
        return { block: true, reason: "Do not wait for a background job. End the turn or do other work; a message reports the result." };
      const lines = (p: string) => {
        const file = absolutePath(p, ctx.cwd, { toolPath: false });
        try {
          if (statSync(file).size > 50_000_000) return undefined;
          return readFileSync(file, "utf8").split("\n").length - 1;
        } catch {
          return undefined;
        }
      };
      const reason = checkBash(input.command, lines) ?? tracker.check(input.command, recipes);
      if (reason) return { block: true, reason };
      const hint = tracker.started(input.command, recipes);
      if (hint) hints.set(event.toolCallId, hint);
      return;
    }
    if ((event.toolName !== "read" && event.toolName !== "write") || typeof input.path !== "string") return;
    const path = absolutePath(input.path, ctx.cwd);
    if (event.toolName === "write") {
      let old: string;
      try {
        old = readFileSync(path, "utf8");
      } catch (err: any) {
        if (err.code === "ENOENT") return;
        throw err;
      }
      const lines = old.split("\n").length;
      if (lines > WRITE_MAX_LINES)
        return {
          block: true,
          reason: `${input.path} exists with ${lines} lines. Use edit for changes. To replace the whole file, rm it with bash first.`,
        };
      return;
    }
    if (IMAGE_EXT.has(extname(path).toLowerCase())) return;
    if (input.limit != null) {
      input.limit = Math.min(input.limit, READ_LIMIT_MAX);
      return;
    }
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return;
    }
    const lines = text.split("\n").length;
    if (lines > READ_FULL_MAX || text.length > READ_FULL_MAX_CHARS)
      return {
        block: true,
        reason: `${input.path} has ${lines} lines, ${text.length} chars. Use grep to find the lines you need, then read with offset and limit (max ${READ_LIMIT_MAX}).`,
      };
  });

  pi.on("tool_result", (event, ctx) => {
    if ((event.toolName === "edit" || event.toolName === "write") && !event.isError) tracker.changed();
    if (event.toolName === "bash") {
      const text = textOf(event.content) ?? "";
      const command = (event.input as any)?.command;
      if (typeof command === "string") tracker.ended(command, text);
      const hint = hints.get(event.toolCallId);
      hints.delete(event.toolCallId);
      return hint ? { content: [{ type: "text", text: `${text}\n${hint}` }] } : undefined;
    }
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
    if (text === undefined || text.length <= CODEMODE_INLINE_MAX) return;
    const log = outFile(ctx, event.toolCallId, "codemode");
    writeFileSync(log, text);
    const lines = text.split("\n").length;
    return {
      content: [{ type: "text", text: `codemode result: ${lines} lines, ${text.length} chars · log: ${shorten(log)}` }],
    };
  });
}
