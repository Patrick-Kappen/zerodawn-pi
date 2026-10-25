import { stripQuoted } from "../../../shared/util.ts";

const GIT_READ = new Set(["status", "diff", "log", "show"]);
export const RAW_GIT = "# raw-git";

export function checkGit(command: string): string | undefined {
  if (command.includes(RAW_GIT)) return undefined;
  for (const segment of stripQuoted(command).split(/&&|\|\||;|\n/)) {
    const words = segment
      .split("|")[0]
      .trim()
      .replace(/^((do|then|else|\{|\()\s+)+/, "")
      .replace(/^(\w+=[^\s$`]*\s+)+/, "")
      .split(/\s+/);
    if (words[0] !== "git") continue;
    let i = 1;
    while (words[i] === "-C" || words[i] === "-c" || words[i] === "--no-pager") i += words[i] === "--no-pager" ? 1 : 2;
    if (GIT_READ.has(words[i]))
      return `"git ${words[i]}" in bash: use the git tool. If it lacks an option you need, add "${RAW_GIT}" at the end of the bash command.`;
  }
  return undefined;
}
