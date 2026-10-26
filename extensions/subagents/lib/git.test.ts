import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { commitAll, createGit, resolveBase } from "./git.ts";
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

let root: string;
let repo: string;
let first: string;

before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "pi-sub-git-")));
  repo = join(root, "proj");
  await mkdir(repo);
  await sh(repo, "init", "-q", "-b", "main");
  await sh(repo, "config", "user.email", "t@example.com");
  await sh(repo, "config", "user.name", "T");
  await writeFile(join(repo, "a.txt"), "a\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "first");
  first = await sh(repo, "rev-parse", "HEAD");
  await sh(repo, "branch", "other");
  await writeFile(join(repo, "b.txt"), "b\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "second");
});

after(() => rm(root, { recursive: true, force: true }));

test("resolveBase: HEAD by default, with the dirty flag", async () => {
  const head = await sh(repo, "rev-parse", "HEAD");
  assert.deepEqual(await resolveBase(exec, repo), { repo, sha: head, dirty: false });
  await writeFile(join(repo, "c.txt"), "c\n");
  assert.equal((await resolveBase(exec, repo)).dirty, true);
  await rm(join(repo, "c.txt"));
});

test("resolveBase: a branch, a commit and a worktree path", async () => {
  assert.equal((await resolveBase(exec, repo, "other")).sha, first);
  assert.equal((await resolveBase(exec, repo, first)).sha, first);
  const tree = join(root, "tree");
  await sh(repo, "worktree", "add", "-q", "-b", "t", tree, first);
  const viaTree = await resolveBase(exec, repo, tree);
  assert.deepEqual([viaTree.sha, viaTree.repo, viaTree.dirty], [first, repo, false]);
  assert.equal((await resolveBase(exec, tree)).repo, repo);
  await sh(repo, "worktree", "remove", "--force", tree);
  await sh(repo, "branch", "-D", "t");
});

test("resolveBase: a bad base is an error that names it", async () => {
  await assert.rejects(resolveBase(exec, repo, "nope"), /base "nope" is not a branch or commit/);
  await assert.rejects(resolveBase(exec, repo, join(root, "missing")), /base ".*missing" is not a git worktree/);
  await assert.rejects(resolveBase(exec, repo, "--all"), /base "--all" is not valid/);
  await assert.rejects(resolveBase(exec, root), /not in a git repository/);
});

test("createGit: add, state, remove; commitAll: subject, body and trailer", async () => {
  const git = createGit(exec);
  const path = join(root, "wt", "sub-1");
  await git.addWorktree({ repo, sha: first, path, branch: "sub/1" });
  assert.equal(await sh(path, "rev-parse", "HEAD"), first);
  assert.equal(await sh(path, "branch", "--show-current"), "sub/1");
  assert.deepEqual(await git.state(path, first), { dirty: false, moved: false });
  await writeFile(join(path, "n.txt"), "n\n");
  assert.deepEqual(await git.state(path, first), { dirty: true, moved: false });
  const sha = await commitAll(exec, path, { subject: "subagent 1: did it", body: ["n.txt: new"], change: "feature" });
  assert.equal(sha, await sh(path, "rev-parse", "HEAD"));
  assert.deepEqual(await git.state(path, first), { dirty: false, moved: true });
  assert.equal(await sh(path, "log", "-1", "--format=%B"), "subagent 1: did it\n\nn.txt: new\n\nChange: feature");
  await git.removeWorktree(repo, path, "sub/1");
  assert.equal(await sh(repo, "branch", "--list", "sub/1"), "");
  await assert.rejects(readFile(join(path, "n.txt")), /ENOENT/);
});

test("createGit: a bad worktree names the git error", async () => {
  const git = createGit(exec);
  await assert.rejects(
    git.addWorktree({ repo, sha: "0".repeat(40), path: join(root, "x"), branch: "sub/x" }),
    /could not create the worktree .*invalid reference|not a valid/s,
  );
});

test("commitAll: a refused commit throws the git output and leaves a clean index; the next try commits", async () => {
  const git = createGit(exec);
  const path = join(root, "wt", "sub-2");
  await git.addWorktree({ repo, sha: first, path, branch: "sub/2" });
  const hook = join(repo, ".git", "hooks", "commit-msg");
  await writeFile(hook, '#!/bin/sh\ngrep -q "^scope: " "$1" || { echo hook says no >&2; exit 1; }\n', { mode: 0o755 });
  await writeFile(join(path, "n.txt"), "n\n");
  await assert.rejects(commitAll(exec, path, { subject: "bad", body: [], change: "fix" }), /was refused\. Call handoff again.*hook says no/s);
  assert.equal(await sh(path, "diff", "--cached", "--name-only"), "");
  assert.equal(await sh(path, "rev-parse", "HEAD"), first);
  await commitAll(exec, path, { subject: "scope: good", body: [], change: "fix" });
  assert.equal(await sh(path, "log", "-1", "--format=%s"), "scope: good");
  await rm(hook);
  await git.removeWorktree(repo, path, "sub/2");
});
