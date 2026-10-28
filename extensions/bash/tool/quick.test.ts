import assert from "node:assert/strict";
import { test } from "node:test";
import { isQuick } from "./quick.ts";

const quick = [
  "ls -la",
  "cd /tmp && ls",
  "pwd; whoami",
  "git status --short",
  "git -C ../x log -5",
  "ls | wc -l",
  "echo 'sleep 60 & just build'",
  "FOO=1 env",
  "mkdir -p a && touch a/b 2>&1",
  ":",
];
const slow = [
  "just build",
  "sleep 5",
  "ls && sleep 5",
  "git push",
  "git -C x fetch",
  "ls | xargs du -sh",
  "echo $(just version)",
  'echo "$(sleep 9)"',
  "echo `date`",
  "ls &",
  "ls & pwd",
  "diff <(ls a) <(ls b)",
];
for (const c of quick) test(`quick: ${c}`, () => assert.equal(isQuick(c), true, c));
for (const c of slow) test(`background: ${c}`, () => assert.equal(isQuick(c), false, c));
