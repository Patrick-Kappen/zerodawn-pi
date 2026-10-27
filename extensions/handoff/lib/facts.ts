import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Run = (cmd: string, args: string[], cwd: string) => string;

export const run: Run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] }).trim();

const firstLine = (err: unknown) => String((err as { stderr?: string }).stderr || (err as Error).message).split("\n")[0];

function tryRun(exec: Run, label: string, cmd: string, args: string[], cwd: string): string[] | string {
  try {
    return exec(cmd, args, cwd).split("\n").filter(Boolean);
  } catch (err) {
    return `${label}: unknown (${cmd} failed: ${firstLine(err)})`;
  }
}

export function gitFacts(cwd: string, exec: Run = run): string[] {
  const branch = tryRun(exec, "branch", "git", ["branch", "--show-current"], cwd);
  if (typeof branch === "string") return [`git: not a repository (${cwd})`];
  const out = [`branch: ${branch[0] ?? "(detached)"} in ${cwd}`];
  const dirty = tryRun(exec, "dirty files", "git", ["status", "--porcelain"], cwd);
  if (typeof dirty === "string") out.push(dirty);
  else if (dirty.length)
    out.push(
      `dirty files (${dirty.length}): ${dirty
        .slice(0, 10)
        .map((l) => l.slice(3))
        .join(", ")}`,
    );
  const trees = tryRun(exec, "worktrees", "git", ["worktree", "list"], cwd);
  if (typeof trees === "string") out.push(trees);
  else if (trees.length > 1)
    out.push(
      `worktrees: ${trees
        .slice(1)
        .map((l) => l.split(/\s+/)[0])
        .join(", ")}`,
    );
  const prs = tryRun(
    exec,
    "open PRs",
    "gh",
    ["pr", "list", "--author", "@me", "--state", "open", "--json", "number,title", "-q", '.[]|"#\\(.number) \\(.title)"'],
    cwd,
  );
  if (typeof prs === "string") {
    if (!/no git remotes/.test(prs)) out.push(prs);
  } else if (prs.length) out.push(`open PRs: ${prs.join("; ")}`);
  return out;
}

export function jobFacts(sessionDir: string): string[] {
  const dir = join(sessionDir, "jobs");
  if (!existsSync(dir)) return [];
  const open: string[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const path = join(dir, name);
    let m: { id: string; command: string; bg?: boolean; reported?: boolean; status: string };
    try {
      m = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new Error(`handoff: cannot read the job file ${path}: ${(err as Error).message}. Remove or fix the file.`, { cause: err });
    }
    if (!m.bg || m.reported) continue;
    open.push(`${m.id} (${existsSync(m.status) ? "ended, report pending" : "running"}): ${m.command.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  return open.length ? [`bash jobs: ${open.join("; ")}`] : [];
}
