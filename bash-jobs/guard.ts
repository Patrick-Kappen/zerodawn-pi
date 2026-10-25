
const VIEW = new Set(["cat", "head", "tail", "nl", "less", "more"]);
const GIT_READ = new Set(["status", "diff", "log", "show"]);
export const RAW_GIT = "# raw-git";
export const NO_TIME_LIMIT = "# no-time-limit";
const WAIT = new Set(["sleep", "wait", "true", ":"]);

function strip(cmd: string): string {
  return cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "<<H$3")
    .replace(/'[^']*'/g, "Q")
    .replace(/"(?:[^"\\]|\\.)*"/g, "Q");
}

export function waitsOnly(command: string): boolean {
  const words = strip(command)
    .split(/&&|\|\||;|\n/)
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
  return words.length > 0 && words.every((w) => WAIT.has(w));
}

export function readFor(command: string, lines: (path: string) => number | undefined = () => undefined): string | undefined {
  const unq = (s: string) => s.replace(/^['"]|['"]$/g, "");
  let m: RegExpMatchArray | null;
  if ((m = command.match(/\btail\s+(?:(?:-n\s*|-)(\+)?(\d+)\s+|\+(\d+)\s+)?([^\s-]\S*)\s*(?:$|[|;&])/))) {
    const path = unq(m[4]);
    if (m[1] || m[3]) return `read ${path} offset=${Math.max(1, Number(m[2] ?? m[3]))}`;
    const n = Number(m[2] ?? 10);
    const total = lines(path);
    return total === undefined ? `read ${path} with offset (line count - ${n} + 1) and limit ${n}` : `read ${path} offset=${Math.max(1, total - n + 1)} limit=${n}`;
  }
  if ((m = command.match(/\bhead\s+(?:-n\s*|-)?(\d+)?\s*(\S+)/))) return `read ${unq(m[2])} limit=${Number(m[1] ?? 10)}`;
  if ((m = command.match(/\bsed\s+-n\s+['"]?(\d+)(?:,(\d+))?p['"]?\s+(\S+)/))) {
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    return `read ${unq(m[3])} offset=${a} limit=${b - a + 1}`;
  }
  if ((m = command.match(/\b(?:cat|nl|less|more)\s+(?:-\S+\s+)*(\S+)/))) return `read ${unq(m[1])}`;
  return undefined;
}

export function checkBash(command: string, lines?: (path: string) => number | undefined): string | undefined {
  const rawGit = command.includes(RAW_GIT);
  for (const segment of strip(command).split(/&&|\|\||;|\n/)) {
    const first = segment.split("|")[0];
    const words = first
      .trim()
      .replace(/^((do|then|else|\{|\()\s+)+/, "")
      .replace(/^(\w+=[^\s$`]*\s+)+/, "")
      .split(/\s+/);
    const cmd = words[0];
    if (VIEW.has(cmd) && words.length > 1 && !/<<|>/.test(first)) {
      const use = readFor(command, lines);
      return `"${cmd}" shows a file. Use the read tool instead${use ? `: ${use}` : " (offset/limit for a range)"}. Or pass the file to the next command directly.`;
    }
    if (cmd === "sed" && words.includes("-n") && !words.some((w) => w.startsWith("-i"))) {
      const use = readFor(command, lines);
      return `"sed -n" shows a file. Use the read tool instead${use ? `: ${use}` : " with offset and limit"}.`;
    }
    if (cmd === "git" && !rawGit) {
      let i = 1;
      while (words[i] === "-C" || words[i] === "-c" || words[i] === "--no-pager") i += words[i] === "--no-pager" ? 1 : 2;
      if (GIT_READ.has(words[i]))
        return `"git ${words[i]}" in bash: use the git tool. If it lacks an option you need, add "${RAW_GIT}" at the end of the bash command.`;
    }
  }
  return undefined;
}
