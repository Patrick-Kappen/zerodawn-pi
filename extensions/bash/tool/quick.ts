import { stripQuoted } from "../../../shared/util.ts";

// Commands that end in well under a second on normal input. Every other command starts as a background job.
const QUICK = new Set([
  ":",
  "true",
  "false",
  "[",
  "test",
  "cd",
  "pwd",
  "ls",
  "echo",
  "printf",
  "which",
  "type",
  "command",
  "whoami",
  "id",
  "hostname",
  "date",
  "env",
  "printenv",
  "uname",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "stat",
  "file",
  "wc",
  "cat",
  "head",
  "tail",
  "sort",
  "uniq",
  "cut",
  "tr",
  "tee",
  "jq",
  "mkdir",
  "touch",
  "rm",
  "rmdir",
  "mv",
  "cp",
  "ln",
  "chmod",
]);

const QUICK_GIT = new Set(["status", "log", "show", "diff", "branch", "rev-parse", "remote", "config", "ls-files", "worktree", "stash", "tag", "describe"]);
const PREFIX = new Set(["do", "then", "else", "fi", "done", "{", "}", "(", ")", "!", "time"]);

function quickStage(stage: string): boolean {
  const words = stage.trim().split(/\s+/).filter(Boolean);
  while (words.length && (PREFIX.has(words[0]) || /^\w+=/.test(words[0]))) words.shift();
  if (!words.length) return true;
  const cmd = words[0].split("/").pop() as string;
  if (cmd !== "git") return QUICK.has(cmd);
  let i = 1;
  while (i < words.length && /^-[Cc]$/.test(words[i])) i += 2;
  return QUICK_GIT.has(words[i] ?? "");
}

/** A command is quick when every stage of every statement starts with a quick command, with no command substitution and no `&`. */
export function isQuick(command: string): boolean {
  // A substitution in double quotes runs too, so look for it before the quotes go.
  if (/\$\(|`|<\(/.test(command)) return false;
  const plain = stripQuoted(command);
  if (/(?<![>&<])&(?![>&])/.test(plain)) return false;
  return plain.split(/&&|\|\||;|\n|\|&?/).every(quickStage);
}
