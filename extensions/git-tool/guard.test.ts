import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGit } from "./guard.ts";

const blocked = ["git status", "git -C /repo diff --stat", "git --no-pager log -5", "cd /x && git show HEAD~1"];
const allowed = [
  "git commit -m 'fix; cat is fine here'",
  'git commit -m "show; git status"',
  "git add -A && git commit -qm x",
  "git show HEAD:flake.nix # raw-git",
  "x=$(git log -1 --format=%H) && echo $x",
  "cat README.md",
  "echo done",
];

for (const c of blocked) test(`blocks: ${c}`, () => assert.ok(checkGit(c), c));
for (const c of allowed) test(`allows: ${c}`, () => assert.equal(checkGit(c), undefined, c));
