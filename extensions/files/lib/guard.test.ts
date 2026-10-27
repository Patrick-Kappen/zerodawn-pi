import assert from "node:assert/strict";
import { test } from "node:test";
import { fileView } from "./guard.ts";

test("file views in bash are found", () => {
  for (const [command, cmd] of [
    ["cat README.md", "cat"],
    ["cd x && cat a.ts b.ts; grep -n foo lib/x.ts", "cat"],
    ["head -80 README.md", "head"],
    ["cat README.md | head -80", "cat"],
    ["sed -n '10,40p' file.ts", "sed"],
    ["tail -n 20 build.log", "tail"],
    ["grep -rn 'x' extensions", "grep"],
    ["for f in *.md; do cat $f; done", "cat"],
    ["/bin/cat x 2>&1", "cat"],
    ["nl -ba x.ts | sed -n '1,20p'", "nl"],
  ])
    assert.equal(fileView(command), cmd, command);
});

test("other uses of these programs are allowed", () => {
  for (const command of [
    "git diff | head -20",
    "ls | grep foo",
    "cat > out.txt <<'EOF'\ncat secret\nEOF",
    "cat a b > c",
    "cat a.json | jq .x",
    "tail -f server.log",
    "sed -i 's/a/b/' x.ts",
    "grep -l foo -r src",
    "grep -c foo x.ts",
    "grep -q foo x.ts && echo yes",
    "echo hi | grep h",
    "ssh host 'cat /etc/hostname'",
    "head -c 100 /dev/urandom | base64",
    "cat <<EOF\nhello\nEOF",
    "sleep 1 & cat",
  ])
    assert.equal(fileView(command), undefined, command);
});
