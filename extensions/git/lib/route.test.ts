import assert from "node:assert/strict";
import { test } from "node:test";
import { gitRoute } from "./route.ts";

const command = (part: string) => gitRoute(part)?.command;

test("a git read runs the git command of the tool", () => {
  assert.equal(command("git status --short"), "git --no-pager status --porcelain=v1 -b");
  assert.equal(command("git -C ../x diff --cached -- a.ts"), "git -C ../x --no-pager diff --cached -U1 --no-color --no-ext-diff -- a.ts");
  assert.equal(command("git --no-pager log --oneline -3 main"), "git --no-pager log --oneline --no-decorate -n3 main");
  assert.equal(command("git log -n 80"), "git --no-pager log --oneline --no-decorate -n50");
  assert.equal(command("git show abc --stat"), "git --no-pager show --numstat '--format=%h %an %ad%n%s%n%b' --date=short abc");
  assert.equal(command("git status src"), "git --no-pager status --porcelain=v1 -b -- src");
});

test("the output gets the compact form of the tool, and a failure stays as it is", () => {
  const r = gitRoute("git diff") as { format: (out: string, exit: number) => string };
  assert.equal(r.format("1\t2\ta.ts", 0), "+1 -2 a.ts\n1 files, +1 -2");
  assert.equal(r.format("fatal: bad", 128), "fatal: bad");
});

test("other commands, git writes, shell syntax and options that the tool does not have run as written", () => {
  for (const part of ["ls", "git add .", "git log | head", "git log --format='%s'", "git -c a=b log", "git log --graph", "git diff main feature"])
    assert.equal(gitRoute(part), undefined, part);
});
