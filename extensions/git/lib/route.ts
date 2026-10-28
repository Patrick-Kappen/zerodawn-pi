import type { Route } from "../../../shared/route.ts";
import { compact, type GitParams, gitArgs } from "./git.ts";

// Options that the tool output replaces; the tool gives its own compact form.
const SAME: Record<GitParams["action"], RegExp> = {
  status: /^(-s|-b|-sb|-bs|--short|--branch|--porcelain(=v1)?)$/,
  diff: /^(--stat|--numstat|--shortstat|--name-only|--name-status|--no-color|-U\d+|--unified=\d+)$/,
  log: /^(--oneline|--no-decorate|--no-color)$/,
  show: /^(--stat|--numstat|--name-only|--name-status|--no-color|--oneline|-U\d+)$/,
};
const SHELL = /[|<>$`'"\\(){}*?[\];&#~]/;
const quote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);

/**
 * The git tool for a "git status|diff|log|show" part of a command: the shell runs the git command of the tool, and the
 * output gets the compact form of the tool. A part with shell syntax, or with an option that the tool does not have,
 * runs as written.
 */
export function gitRoute(part: string): Route | undefined {
  if (SHELL.test(part)) return undefined;
  const words = part.split(/\s+/);
  if (words[0] !== "git") return undefined;
  const global: string[] = [];
  let i = 1;
  for (; words[i]?.startsWith("-"); i++) {
    if (words[i] === "--no-pager") continue;
    if (words[i] !== "-C" || !words[i + 1]) return undefined;
    global.push("-C", words[++i]);
  }
  const action = words[i] as GitParams["action"];
  if (!(action in SAME)) return undefined;
  const params: GitParams = { action, paths: [] };
  const refs: string[] = [];
  const rest = words.slice(i + 1);
  for (let j = 0; j < rest.length; j++) {
    const w = rest[j];
    const n = w.match(/^-(\d+)$|^(?:-n|--max-count=)(\d+)$/);
    if (w === "--") {
      params.paths = rest.slice(j + 1);
      break;
    }
    if (SAME[action].test(w)) continue;
    if (action === "diff" && (w === "--cached" || w === "--staged")) params.staged = true;
    else if (action === "log" && n) params.n = Number(n[1] ?? n[2]);
    else if (action === "log" && w === "-n" && /^\d+$/.test(rest[j + 1] ?? "")) params.n = Number(rest[++j]);
    else if (w.startsWith("-")) return undefined;
    else refs.push(w);
  }
  if (action === "status") params.paths = [...refs, ...(params.paths ?? [])];
  else if (refs.length > 1) return undefined;
  else params.ref = refs[0];
  const args = gitArgs(params);
  return {
    command: ["git", ...global, "--no-pager", ...args].map(quote).join(" "),
    format: (output, exit) => (exit === 0 ? compact(params, output) : output),
  };
}
