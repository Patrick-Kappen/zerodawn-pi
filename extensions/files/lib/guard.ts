import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripQuoted } from "../../../shared/util.ts";

const VIEWERS = new Set(["cat", "head", "tail", "less", "more", "nl", "bat", "batcat", "sed", "grep", "egrep", "rg"]);
const PREFIX = new Set(["do", "then", "else", "{", "(", "!", "time"]);
const ARG_OPTION: Record<string, RegExp> = {
  head: /^-[nc]$|^--(lines|bytes)$/,
  tail: /^-[nc]$|^--(lines|bytes)$/,
  sed: /^-[ef]$/,
  grep: /^-[eABCmf]$|^--(regexp|file|max-count)$/,
  rg: /^-[eABCmfgt]$|^--(regexp|file|max-count|glob|type)$/,
};
const SHORT_OUTPUT = /^-[a-zA-Z]*[lLcq]/;

type Stage = { cmd: string; args: string[]; toFile: boolean };

function parse(stage: string): Stage | undefined {
  const words = stage.trim().split(/\s+/).filter(Boolean);
  while (words.length && (PREFIX.has(words[0]) || /^\w+=/.test(words[0]))) words.shift();
  if (!words.length) return undefined;
  const cmd = words[0].split("/").pop()!;
  const args: string[] = [];
  let toFile = false;
  for (let i = 1; i < words.length; i++) {
    const r = words[i].match(/^(\d*|&)(>>?|<<?)(.*)$/);
    if (!r) {
      args.push(words[i]);
      continue;
    }
    const target = r[3] || words[++i] || "";
    if (r[2].startsWith(">") && r[1] !== "2" && !target.startsWith("&") && target !== "/dev/stdout") toFile = true;
  }
  return { cmd, args, toFile };
}

// A viewer prints a file to the model when it has a file argument and its output is not written to a file.
function viewsFile(s: Stage): boolean {
  const { cmd, args } = s;
  if (!VIEWERS.has(cmd) || s.toFile) return false;
  if (cmd === "tail" && args.some((a) => /^-[a-zA-Z]*[fF]|^--follow/.test(a))) return false;
  if (cmd === "sed" && !args.some((a) => /^-[a-zA-Z]*n/.test(a))) return false;
  if (/grep$|^rg$/.test(cmd) && args.some((a) => SHORT_OUTPUT.test(a) || /^--(files-with|count|quiet)/.test(a))) return false;
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (ARG_OPTION[/grep$/.test(cmd) ? "grep" : cmd]?.test(args[i])) i++;
    else if (!args[i].startsWith("-") || args[i] === "-") operands.push(args[i]);
  }
  const script = /^sed$|grep$|^rg$/.test(cmd) && !args.some((a) => /^-[a-zA-Z]*e$|^--regexp/.test(a));
  return operands.filter((o) => o !== "-").length > (script ? 1 : 0);
}

export function fileView(command: string): string | undefined {
  for (const statement of stripQuoted(command).split(/&&|\|\||;|\n|(?<![>&<])&(?![>&])/)) {
    const stages = statement
      .split(/\|&?/)
      .map(parse)
      .filter((s): s is Stage => s !== undefined);
    if (!stages.length || !viewsFile(stages[0])) continue;
    if (stages.slice(1).every((s) => VIEWERS.has(s.cmd) && !s.toFile)) return stages[0].cmd;
  }
  return undefined;
}

export function registerViewGuard(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    const command = (event.input as { command?: unknown }).command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    const cmd = fileView(command);
    if (!cmd) return;
    if (/grep$|^rg$/.test(cmd))
      return {
        block: true,
        reason: `"${cmd}" on a file or directory in bash: use the grep tool. It has glob, type, context, filesOnly, count, multiline, and noIgnore for node_modules and other ignored paths.`,
      };
    return {
      block: true,
      reason: `"${cmd}" on a file in bash: use grep to find the lines, then read with offset and limit (offset=-N for the last N lines). Pipe the file into a program that is not a viewer to process it.`,
    };
  });
}
