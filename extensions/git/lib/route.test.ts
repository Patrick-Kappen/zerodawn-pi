import assert from "node:assert/strict";
import { test } from "node:test";
import { gitRoute } from "./route.ts";

const command = (part: string) => {
  const r = gitRoute(part);
  return r && "command" in r ? r.command : r;
};

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

test("other commands, git writes, shell syntax and raw-git are not routed", () => {
  for (const part of ["ls", "git add .", "git log | head", "git log --format='%s'", "git log # raw-git", "git -c a=b log"])
    assert.equal(gitRoute(part), undefined, part);
});

test("an option that the tool does not have refuses the chain", () => {
  assert.match((gitRoute("git log --graph") as { block: string }).block, /"--graph" in "git log": the git tool has no such option/);
  assert.match((gitRoute("git diff main feature") as { block: string }).block, /"main feature without --"/);
});
