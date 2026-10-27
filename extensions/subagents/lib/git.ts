import { basename, dirname, isAbsolute } from "node:path";
import type { Exec } from "./tmux.ts";

export const MAX_SUBJECT = 72;

export interface Source {
  repo: string;
  sha: string;
}

export interface Resolved extends Source {
  dirty: boolean;
}

export interface WorktreeSpec extends Source {
  path: string;
  branch: string;
}

export interface CommitSpec {
  subject: string;
  body: string[];
  change: string;
}

/** Runs in the subagent: commits all changes in its worktree. A refused commit leaves the index clean and throws. */
export async function commitAll(exec: Exec, path: string, spec: CommitSpec): Promise<string> {
  await git(exec, ["-C", path, "add", "-A"], `could not stage the changes in "${path}"`);
  const paragraphs = [...(spec.body.length > 0 ? [spec.body.join("\n")] : []), `Change: ${spec.change}`];
  try {
    await git(
      exec,
      ["-C", path, "commit", "-m", spec.subject, ...paragraphs.flatMap((paragraph) => ["-m", paragraph])],
      `the commit in "${path}" was refused. Call handoff again with a subject that obeys the commit rules of the repository`,
    );
  } catch (cause) {
    await git(exec, ["-C", path, "reset", "-q"], `could not reset the index in "${path}" after the refused commit`);
    throw cause;
  }
  return git(exec, ["-C", path, "rev-parse", "HEAD"], `could not read HEAD of "${path}"`);
}

export async function git(exec: Exec, args: string[], what: string): Promise<string> {
  let result: Awaited<ReturnType<Exec>>;
  try {
    result = await exec("git", args);
  } catch (cause) {
    throw new Error(`subagents: could not run "git ${args.join(" ")}". Make sure git is in PATH.`, { cause });
  }
  if (result.code !== 0) {
    throw new Error(`subagents: ${what}: "git ${args.join(" ")}" failed with exit code ${result.code}: ${`${result.stderr}${result.stdout}`.trim()}`);
  }
  return result.stdout.trim();
}

/** Runs in the main pi: finds the repo root and the commit that the worktree starts on. */
export async function resolveBase(exec: Exec, cwd: string, base?: string): Promise<Resolved> {
  if (base !== undefined && (base.trim() === "" || base.startsWith("-"))) {
    throw new Error(`subagent: base "${base}" is not valid. Give a branch, a commit or the absolute path of a worktree.`);
  }
  const common = await git(exec, ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], `"${cwd}" is not in a git repository`);
  if (basename(common) !== ".git") {
    throw new Error(`subagent: the git directory "${common}" of "${cwd}" is not a ".git" directory. Bare repositories are not supported.`);
  }
  const repo = dirname(common);
  if (base === undefined) {
    const sha = await git(exec, ["-C", cwd, "rev-parse", "--verify", "HEAD^{commit}"], `"${cwd}" has no commit to start from`);
    const dirty = (await git(exec, ["-C", cwd, "status", "--porcelain"], `could not read the status of "${cwd}"`)) !== "";
    return { repo, sha, dirty };
  }
  if (isAbsolute(base)) {
    return { repo, sha: await git(exec, ["-C", base, "rev-parse", "--verify", "HEAD^{commit}"], `base "${base}" is not a git worktree`), dirty: false };
  }
  return {
    repo,
    sha: await git(exec, ["-C", repo, "rev-parse", "--verify", `${base}^{commit}`], `base "${base}" is not a branch or commit of "${repo}"`),
    dirty: false,
  };
}

/** Runs in the supervisor: the git work on the worktree of a subagent. */
export function createGit(exec: Exec) {
  async function addWorktree(spec: WorktreeSpec): Promise<void> {
    await git(exec, ["-C", spec.repo, "worktree", "add", "-b", spec.branch, spec.path, spec.sha], `could not create the worktree "${spec.path}"`);
  }

  async function state(path: string, base: string): Promise<{ dirty: boolean; moved: boolean }> {
    const dirty = (await git(exec, ["-C", path, "status", "--porcelain"], `could not read the status of "${path}"`)) !== "";
    const head = await git(exec, ["-C", path, "rev-parse", "HEAD"], `could not read HEAD of "${path}"`);
    return { dirty, moved: head !== base };
  }

  async function removeWorktree(repo: string, path: string, branch: string): Promise<void> {
    await git(exec, ["-C", repo, "worktree", "remove", "--force", path], `could not remove the worktree "${path}"`);
    await git(exec, ["-C", repo, "branch", "-D", branch], `could not delete the branch "${branch}"`);
  }

  async function changed(path: string): Promise<string[]> {
    const out = await git(exec, ["-C", path, "status", "--short"], `could not read the status of "${path}"`);
    return out === "" ? [] : out.split("\n").map((line) => line.trim());
  }

  return { addWorktree, state, removeWorktree, changed };
}

export type Git = ReturnType<typeof createGit>;
