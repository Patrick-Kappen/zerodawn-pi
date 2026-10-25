import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBash, readFor, waitsOnly } from "./guard.ts";

const blocked = [
  "cat README.md",
  "cd /x && cat a.nix b.nix",
  "git commit -qam 'msg'; cat packages/x.nix",
  "sed -n '1,40p' file.ts",
  "head -50 file.ts",
  "for f in a b; do sed -n '1,5p' $f; done",
  "cat file.json | jq .x",
  "git status",
  "git -C /repo diff --stat",
  "git --no-pager log -5",
  "cd /x && git show HEAD~1",
];
const allowed = [
  "cat > out.txt <<'EOF'\nhello\nEOF",
  "python3 - <<'E'\nhead = 1\ncat = 2\nE",
  "git commit -m 'fix; cat is fine here'",
  'git commit -m "show; git status"',
  "git add -A && git commit -qm x",
  "ls | head -5",
  "sed -i 's/a/b/' file",
  "nix build .#x 2>&1 | tail -20",
  "git show HEAD:flake.nix # raw-git",
  "x=$(git log -1 --format=%H) && echo $x",
  "echo done",
];

for (const c of blocked) test(`blocks: ${c.split("\n")[0]}`, () => assert.ok(checkBash(c), c));
for (const c of allowed) test(`allows: ${c.split("\n")[0]}`, () => assert.equal(checkBash(c), undefined, c));

test("readFor: the read call that does the same as the view", () => {
  const lines = (p: string) => (p === "/s/out/2.9-C1.bash.log" ? 4900 : undefined);
  assert.equal(readFor("tail -100 /s/out/2.9-C1.bash.log", lines), "read /s/out/2.9-C1.bash.log offset=4801 limit=100");
  assert.equal(readFor("tail -n 50 /s/out/2.9-C1.bash.log", lines), "read /s/out/2.9-C1.bash.log offset=4851 limit=50");
  assert.equal(readFor("cd /w && tail x.log", lines), "read x.log with offset (line count - 10 + 1) and limit 10");
  assert.equal(readFor("head -n 30 src/a.ts"), "read src/a.ts limit=30");
  assert.equal(readFor("sed -n '20,60p' src/a.ts"), "read src/a.ts offset=20 limit=41");
  assert.equal(readFor("cat README.md"), "read README.md");
  assert.equal(readFor("tail -n 5 /s/out/2.9-C1.bash.log | grep x", lines), "read /s/out/2.9-C1.bash.log offset=4896 limit=5");
  assert.equal(readFor("tail -n5 x.log"), "read x.log with offset (line count - 5 + 1) and limit 5");
  assert.equal(readFor("tail -f x.log"), undefined);
  assert.match(checkBash("tail -100 /s/out/2.9-C1.bash.log", lines)!, /Use the read tool instead: read \/s\/out\/2\.9-C1\.bash\.log offset=4801 limit=100/);
});

test("readFor: tail from line N reads from offset N without a limit", () => {
  const lines = () => 4900;
  assert.equal(readFor("tail -n +5 foo.txt", lines), "read foo.txt offset=5");
  assert.equal(readFor("tail -n+5 foo.txt", lines), "read foo.txt offset=5");
  assert.equal(readFor("tail +5 foo.txt", lines), "read foo.txt offset=5");
  assert.equal(readFor("cd /w && tail -n +120 src/a.ts | head -20"), "read src/a.ts offset=120");
  assert.equal(readFor("tail -n +0 foo.txt"), "read foo.txt offset=1");
  assert.equal(readFor("tail -n 5 foo.txt", lines), "read foo.txt offset=4896 limit=5");
  assert.equal(readFor("tail -5 foo.txt", lines), "read foo.txt offset=4896 limit=5");
  assert.match(checkBash("tail -n +5 foo.txt", lines)!, /Use the read tool instead: read foo\.txt offset=5\. /);
});

const waiting = ["sleep 30", "sleep 5; sleep 5", "sleep 10 && wait", "true"];
const working = ["sleep 2 && ls", "nix build .#x", "echo 'sleep 5'", ""];
for (const c of waiting) test(`waits only: ${c}`, () => assert.equal(waitsOnly(c), true, c));
for (const c of working) test(`does work: ${c || "(empty)"}`, () => assert.equal(waitsOnly(c), false, c));
