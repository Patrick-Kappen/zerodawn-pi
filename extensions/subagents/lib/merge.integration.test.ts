import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createGit } from "./git.ts";
import { cleanupAt, cleanupMerged, type MergeDeps, mergeBranches } from "./merge.ts";
import type { AgentEntry } from "./register.ts";
import type { Exec } from "./tmux.ts";

const exec: Exec = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 127;
      resolve({ stdout, stderr, code, killed: false });
    });
  });

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec("git", ["-C", cwd, ...args]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

let root: string;
let home: string;
let repo: string;
let agents: AgentEntry[];
let started: { task: string; sha: string }[];

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pi-sub-merge-")));
  home = join(root, "home");
  repo = join(root, "proj");
  await mkdir(repo);
  await mkdir(home);
  await sh(repo, "init", "-q", "-b", "main");
  await sh(repo, "config", "user.email", "t@example.com");
  await sh(repo, "config", "user.name", "T");
  await writeFile(join(repo, "a.txt"), "a\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "first");
  agents = [];
  started = [];
});

afterEach(() => rm(root, { recursive: true, force: true }));

async function agent(id: string, file: string, content: string, status: AgentEntry["status"] = "idle", commit = true): Promise<AgentEntry> {
  const short = id.slice(0, 8);
  const worktree = join(home, ".worktrees", "proj", `sub-${short}`);
  const base = await sh(repo, "rev-parse", "HEAD");
  await sh(repo, "worktree", "add", "-q", "-b", `sub/${short}`, worktree, base);
  if (commit) {
    await writeFile(join(worktree, file), content);
    await sh(worktree, "add", "-A");
    await sh(worktree, "commit", "-q", "-m", `${id}: change`);
  }
  const entry: AgentEntry = { id, role: "sub", window: "@1", base, worktree, branch: `sub/${short}`, status };
  agents.push(entry);
  return entry;
}

function deps(overrides: Partial<MergeDeps> = {}): MergeDeps {
  return {
    exec,
    cwd: repo,
    home,
    runtimeRoot: join(root, "run"),
    agents: async () => agents,
    discard: async (id) => {
      const entry = agents.find((candidate) => candidate.id === id) as AgentEntry;
      await createGit(exec).removeWorktree(repo, entry.worktree as string, entry.branch as string);
      delete entry.worktree;
      delete entry.branch;
      return "removed";
    },
    startMerge: async (task, source) => {
      started.push({ task, sha: source.sha });
      return "helper-id";
    },
    ...overrides,
  };
}

test("merge: two agent branches go into the current branch and their worktrees go away", async () => {
  const one = await agent("aaaaaaaa-1", "one.txt", "1\n");
  const two = await agent("bbbbbbbb-2", "two.txt", "2\n");
  const text = await mergeBranches(deps(), ["aaaaaaaa-1", "bbbbbbbb-2"]);
  assert.match(text, /merged: aaaaaaaa-1, bbbbbbbb-2\nmain is now [0-9a-f]+ Merge branch 'sub\/bbbbbbbb'/);
  assert.equal(await readFile(join(repo, "one.txt"), "utf8"), "1\n");
  assert.equal(await readFile(join(repo, "two.txt"), "utf8"), "2\n");
  assert.equal(await exists(one.worktree as string), false);
  assert.equal(await exists(two.worktree as string), false);
  assert.equal(await sh(repo, "branch", "--list", "sub/*"), "");
  assert.equal(await sh(repo, "rev-list", "--merges", "--count", "HEAD"), "2");
});

test("merge: a conflict aborts, keeps the target clean and starts a merge agent", async () => {
  await agent("aaaaaaaa-1", "one.txt", "1\n");
  await agent("bbbbbbbb-2", "a.txt", "from agent\n");
  await agent("cccccccc-3", "three.txt", "3\n");
  await writeFile(join(repo, "a.txt"), "from main\n");
  await sh(repo, "commit", "-q", "-am", "main change");
  await assert.rejects(
    mergeBranches(deps(), ["aaaaaaaa-1", "bbbbbbbb-2", "cccccccc-3"]),
    /Merged: aaaaaaaa-1\. Conflict: agent bbbbbbbb-2 in a\.txt\. Merge agent helper-id started with profile "merge".*Not merged: bbbbbbbb-2, cccccccc-3/,
  );
  assert.equal(await sh(repo, "status", "--porcelain"), "");
  assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "from main\n");
  assert.equal(await readFile(join(repo, "one.txt"), "utf8"), "1\n");
  assert.equal(started.length, 1);
  assert.equal(started[0]?.sha, await sh(repo, "rev-parse", "HEAD"));
  assert.match(
    started[0]?.task as string,
    /^Merge the branch sub\/bbbbbbbb into this worktree with `git merge sub\/bbbbbbbb`\. Resolve only the conflicts in: a\.txt\./,
  );
  assert.equal(agents[1]?.branch, "sub/bbbbbbbb");
});

test("merge: a missing merge profile at a conflict is an error that names the cause", async () => {
  await agent("aaaaaaaa-1", "a.txt", "from agent\n");
  await writeFile(join(repo, "a.txt"), "from main\n");
  await sh(repo, "commit", "-q", "-am", "main change");
  await assert.rejects(
    mergeBranches(
      deps({
        startMerge: async () => {
          throw new Error('subagent: profile "merge" not found. Create /h/.pi/agent/agents/merge.md.');
        },
      }),
      ["aaaaaaaa-1"],
    ),
    /conflicts in a\.txt and no merge agent started: .*merge\.md.*Not merged: aaaaaaaa-1/,
  );
  assert.equal(await sh(repo, "status", "--porcelain"), "");
});

test("merge: a dirty target worktree is an error that names it", async () => {
  await agent("aaaaaaaa-1", "one.txt", "1\n");
  await writeFile(join(repo, "dirty.txt"), "x\n");
  await assert.rejects(mergeBranches(deps(), ["aaaaaaaa-1"]), new RegExp(`${repo}.*uncommitted changes`));
});

test("merge: a detached HEAD without into is an error", async () => {
  await agent("aaaaaaaa-1", "one.txt", "1\n");
  await sh(repo, "checkout", "-q", "--detach");
  await assert.rejects(mergeBranches(deps(), ["aaaaaaaa-1"]), /detached HEAD/);
});

test("merge: a branch that no worktree has checked out gets a temporary worktree", async () => {
  await agent("aaaaaaaa-1", "one.txt", "1\n");
  await sh(repo, "branch", "release");
  const text = await mergeBranches(deps(), ["aaaaaaaa-1"], "release");
  assert.match(text, /release is now/);
  assert.equal(await exists(join(repo, "one.txt")), false);
  assert.equal(await sh(repo, "rev-list", "--merges", "--count", "release"), "1");
  assert.equal(await exists(join(home, ".worktrees", "proj")), true);
  assert.equal((await sh(repo, "worktree", "list", "--porcelain")).includes("/proj/merge-"), false);
});

test("merge: errors for a running agent, an unknown id and an agent without a commit", async () => {
  await agent("aaaaaaaa-1", "one.txt", "1\n", "running");
  await agent("bbbbbbbb-2", "two.txt", "2\n", "idle", false);
  await assert.rejects(mergeBranches(deps(), ["aaaaaaaa-1"]), /agent aaaaaaaa-1 runs/);
  await assert.rejects(mergeBranches(deps(), ["bbbbbbbb-2"]), /nothing to merge for agent bbbbbbbb-2/);
  await assert.rejects(mergeBranches(deps(), ["zzzzzzzz"]), /no agent "zzzzzzzz"/);
  await assert.rejects(mergeBranches(deps(), []), /non-empty list/);
  assert.equal(await exists(join(repo, "one.txt")), false);
});

async function register(entries: AgentEntry[]): Promise<void> {
  await mkdir(join(root, "run", "pi-sub-abcdefgh"), { recursive: true });
  await writeFile(join(root, "run", "pi-sub-abcdefgh", "register.json"), JSON.stringify({ agents: entries }));
}

test("cleanup: a worktree whose branch is in origin/main goes away; running and unmerged ones stay", async () => {
  const merged = await agent("aaaaaaaa-1", "one.txt", "1\n");
  const running = await agent("bbbbbbbb-2", "two.txt", "2\n", "running");
  const open = await agent("cccccccc-3", "three.txt", "3\n");
  const fresh = await agent("dddddddd-4", "four.txt", "4\n", "question", false);
  await sh(repo, "merge", "-q", "--no-ff", "-m", "m1", "sub/aaaaaaaa");
  await sh(repo, "merge", "-q", "--no-ff", "-m", "m2", "sub/bbbbbbbb");
  await sh(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  await register(agents);
  const removed = await cleanupMerged(deps(), repo);
  assert.equal(removed.length, 1);
  assert.match(removed[0] as string, /sub-aaaaaaaa and branch sub\/aaaaaaaa/);
  assert.equal(await exists(merged.worktree as string), false);
  for (const kept of [running, open, fresh]) assert.equal(await exists(kept.worktree as string), true);
});

test("cleanup: a branch that a merge agent merged into the target goes away with target as ref", async () => {
  const merged = await agent("aaaaaaaa-1", "one.txt", "1\n");
  await sh(repo, "merge", "-q", "--no-ff", "-m", "m1", "sub/aaaaaaaa");
  await register(agents);
  const branch = await sh(repo, "symbolic-ref", "--short", "HEAD");
  const removed = await cleanupMerged(deps(), repo, branch);
  assert.match(removed[0] as string, new RegExp(`merged into ${branch}$`));
  assert.equal(await exists(merged.worktree as string), false);
});

test("cleanup: without a local origin/main ref nothing is checked", async () => {
  await agent("aaaaaaaa-1", "one.txt", "1\n");
  await sh(repo, "merge", "-q", "--no-ff", "-m", "m1", "sub/aaaaaaaa");
  assert.deepEqual(await cleanupMerged(deps(), repo), []);
  assert.equal(await exists(join(home, ".worktrees", "proj", "sub-aaaaaaaa")), true);
});

test("cleanupAt: gives nothing outside a git repository", async () => {
  assert.deepEqual(await cleanupAt({ exec, cwd: root, home, runtimeRoot: join(root, "run") }), []);
});

test("cleanupAt: gives nothing in a repository without a commit", async () => {
  const fresh = join(root, "fresh");
  await mkdir(fresh);
  await sh(fresh, "init", "-q");
  assert.deepEqual(await cleanupAt({ exec, cwd: fresh, home, runtimeRoot: join(root, "run") }), []);
});
