import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createGit, git, resolveBase, type Source } from "./git.ts";
import type { AgentEntry } from "./register.ts";
import type { Exec } from "./tmux.ts";

export interface MergeDeps {
  exec: Exec;
  cwd: string;
  home: string;
  runtimeRoot: string;
  agents(): Promise<AgentEntry[]>;
  discard(id: string): Promise<string>;
  startMerge(task: string, source: Source): Promise<string>;
}

interface Tree {
  path: string;
  branch?: string;
}

const ACTIVE = ["starting", "running"];

function parseTrees(porcelain: string): Tree[] {
  return porcelain
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice("branch refs/heads/".length);
      return { path: (lines[0] as string).slice("worktree ".length), ...(branch === undefined ? {} : { branch }) };
    });
}

async function trees(exec: Exec, repo: string): Promise<Tree[]> {
  return parseTrees(await git(exec, ["-C", repo, "worktree", "list", "--porcelain"], `could not list the worktrees of "${repo}"`));
}

async function currentBranch(exec: Exec, cwd: string): Promise<string> {
  const result = await exec("git", ["-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"]);
  if (result.code !== 0 || result.stdout.trim() === "") {
    throw new Error(`subagent: "${cwd}" has a detached HEAD, so "merge" has no target. Give "into" or check out a branch.`);
  }
  return result.stdout.trim();
}

async function readRegisters(runtimeRoot: string): Promise<AgentEntry[]> {
  const entries: AgentEntry[] = [];
  for (const name of (await readdir(runtimeRoot)).filter((dir) => /^pi-sub-[A-Za-z0-9-]{8}$/.test(dir))) {
    const file = join(runtimeRoot, name, "register.json");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`subagents: could not read "${file}". Make sure the file is readable.`, { cause });
    }
    try {
      entries.push(...(JSON.parse(text) as { agents: AgentEntry[] }).agents);
    } catch (cause) {
      throw new Error(`subagents: "${file}" is not a valid register. Remove the directory "${join(runtimeRoot, name)}" when its supervisor is gone.`, {
        cause,
      });
    }
  }
  return entries;
}

/** Removes worktrees `sub-*` whose branch is in `target` (default origin/main) and whose agent does not run. Returns one line for each removal. */
export async function cleanupMerged(deps: Pick<MergeDeps, "exec" | "home" | "runtimeRoot">, repo: string, target = "origin/main"): Promise<string[]> {
  const { exec } = deps;
  const remote = await exec("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${target}^{commit}`]);
  // No origin/main ref (no remote, or no fetch yet): nothing is known to be merged, so this check does not apply.
  if (remote.code !== 0) return [];
  const root = join(deps.home, ".worktrees", basename(repo));
  const entries = await readRegisters(deps.runtimeRoot);
  const removed: string[] = [];
  for (const tree of await trees(exec, repo)) {
    if (tree.branch === undefined || !tree.path.startsWith(`${root}/sub-`) || !tree.branch.startsWith("sub/")) continue;
    const merged = await exec("git", ["-C", repo, "merge-base", "--is-ancestor", tree.branch, target]);
    if (merged.code === 1) continue;
    if (merged.code !== 0) throw new Error(`subagents: "git merge-base --is-ancestor ${tree.branch} ${target}" failed in "${repo}": ${merged.stderr.trim()}`);
    const entry = entries.find((candidate) => candidate.worktree === tree.path);
    if (entry !== undefined && ACTIVE.includes(entry.status)) continue;
    const dirty = await git(exec, ["-C", tree.path, "status", "--porcelain"], `could not read the status of "${tree.path}"`);
    if (dirty !== "") continue;
    // An agent that did not commit yet has its base as HEAD, which is in origin/main too.
    if (entry !== undefined && (await git(exec, ["-C", tree.path, "rev-parse", "HEAD"], `could not read HEAD of "${tree.path}"`)) === entry.base) continue;
    await createGit(exec).removeWorktree(repo, tree.path, tree.branch);
    removed.push(`removed ${tree.path} and branch ${tree.branch}: merged into ${target}`);
  }
  return removed;
}

/** Runs in the main pi when a session starts. Gives nothing outside a git repository or in one without a commit. */
export async function cleanupAt(deps: Pick<MergeDeps, "exec" | "home" | "runtimeRoot" | "cwd">): Promise<string[]> {
  const common = await deps.exec("git", ["-C", deps.cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  // Not in a repository, in a bare one, or before the first commit: no worktrees of this tool exist here.
  if (common.code !== 0 || basename(common.stdout.trim()) !== ".git") return [];
  if ((await deps.exec("git", ["-C", deps.cwd, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"])).code !== 0) return [];
  return cleanupMerged(deps, (await resolveBase(deps.exec, deps.cwd)).repo);
}

export async function mergeBranches(deps: MergeDeps, ids: string[], into?: string): Promise<string> {
  const { exec } = deps;
  if (ids.length === 0) throw new Error('subagent: action "merge" needs a non-empty list "ids".');
  if (new Set(ids).size !== ids.length) throw new Error('subagent: action "merge" got an id twice. Give each id once.');
  if (into !== undefined && (into.trim() === "" || into.startsWith("-"))) throw new Error(`subagent: "into" "${into}" is not a branch name.`);
  const { repo } = await resolveBase(exec, deps.cwd);
  const target = into ?? (await currentBranch(exec, deps.cwd));
  await git(exec, ["-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${target}`], `"${target}" is not a branch of "${repo}"`);

  const known = await deps.agents();
  const branches = new Map<string, string>();
  for (const id of ids) {
    const agent = known.find((entry) => entry.id === id);
    if (agent === undefined) throw new Error(`subagent: no agent "${id}" in this supervisor. Use "status" to list the agents.`);
    if (ACTIVE.includes(agent.status)) throw new Error(`subagent: agent ${id} runs. Wait for its result, then merge it.`);
    if (agent.branch === undefined)
      throw new Error(`subagent: nothing to merge for agent ${id}: it has no branch. It ended without changes, or it was discarded.`);
    const count = await git(exec, ["-C", repo, "rev-list", "--count", `${agent.base}..${agent.branch}`], `could not count the commits of "${agent.branch}"`);
    if (count === "0") throw new Error(`subagent: nothing to merge for agent ${id}: "${agent.branch}" has no commit after its base.`);
    branches.set(id, agent.branch);
  }

  const existing = (await trees(exec, repo)).find((tree) => tree.branch === target);
  let path: string;
  let temporary = false;
  if (existing === undefined) {
    path = join(deps.home, ".worktrees", basename(repo), `merge-${randomBytes(4).toString("hex")}`);
    await git(exec, ["-C", repo, "worktree", "add", path, target], `could not create the worktree "${path}" for "${target}"`);
    temporary = true;
  } else {
    path = existing.path;
    if ((await git(exec, ["-C", path, "status", "--porcelain"], `could not read the status of "${path}"`)) !== "") {
      throw new Error(`subagent: the worktree "${path}" that has "${target}" checked out has uncommitted changes. Commit or stash them, then merge again.`);
    }
  }

  try {
    return await mergeInto(deps, repo, path, target, ids, branches);
  } finally {
    if (temporary) await git(exec, ["-C", repo, "worktree", "remove", "--force", path], `could not remove the temporary worktree "${path}"`);
  }
}

async function mergeInto(deps: MergeDeps, repo: string, path: string, target: string, ids: string[], branches: Map<string, string>): Promise<string> {
  const { exec } = deps;
  const merged: string[] = [];
  for (const [index, id] of ids.entries()) {
    const branch = branches.get(id) as string;
    const result = await exec("git", ["-C", path, "merge", "--no-ff", "--no-edit", branch]);
    if (result.code === 0) {
      try {
        await deps.discard(id);
      } catch (cause) {
        throw new Error(`subagent: merged ${merged.concat(id).join(", ")} into "${target}", but could not remove agent ${id}: ${(cause as Error).message}`, {
          cause,
        });
      }
      merged.push(id);
      continue;
    }
    const files = (await git(exec, ["-C", path, "diff", "--name-only", "--diff-filter=U"], `could not list the conflicts in "${path}"`))
      .split("\n")
      .filter((file) => file !== "");
    const inProgress = (await exec("git", ["-C", path, "rev-parse", "--quiet", "--verify", "MERGE_HEAD"])).code === 0;
    if (inProgress) await git(exec, ["-C", path, "merge", "--abort"], `could not abort the merge in "${path}"`);
    const rest = ids.slice(index + 1);
    if (files.length === 0) {
      throw new Error(
        `subagent: "git merge ${branch}" in "${path}" failed without a conflict: ${`${result.stderr}${result.stdout}`.trim()}. Merged before: ${merged.join(", ") || "none"}. Fix the cause, then merge ${[id, ...rest].join(", ")}.`,
      );
    }
    const sha = await git(exec, ["-C", path, "rev-parse", "HEAD"], `could not read HEAD of "${path}"`);
    const task = `Merge the branch ${branch} into this worktree with \`git merge ${branch}\`. Resolve only the conflicts in: ${files.join(", ")}. Keep both changes where possible. Then call done.`;
    let helper: string;
    try {
      helper = await deps.startMerge(task, { repo, sha });
    } catch (cause) {
      throw new Error(
        `subagent: agent ${id} conflicts in ${files.join(", ")} and no merge agent started: ${(cause as Error).message} Merged before: ${merged.join(", ") || "none"}. Not merged: ${[id, ...rest].join(", ")}.`,
        { cause },
      );
    }
    throw new Error(
      `subagent: merge stopped. Merged: ${merged.join(", ") || "none"}. Conflict: agent ${id} in ${files.join(", ")}. Merge agent ${helper} started with profile "merge"; it works in its own worktree and ends with a handoff. Not merged: ${[id, ...rest].join(", ")}. Merge ${helper} into "${target}" when it ends, then merge the rest.`,
    );
  }
  const head = await git(exec, ["-C", path, "log", "-1", "--format=%h %s"], `could not read HEAD of "${path}"`);
  return `merged: ${merged.join(", ")}\n${target} is now ${head}`;
}
