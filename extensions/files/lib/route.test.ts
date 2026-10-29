import assert from "node:assert/strict";
import { test } from "node:test";
import { fileRoute, grepSpec, readSpec, shellWords, writeSpec } from "./route.ts";

test("shell words keep plain quotes and refuse other shell syntax", () => {
  assert.deepEqual(shellWords(`grep -rn "a b" 'c$d' e`), ["grep", "-rn", "a b", "c$d", "e"]);
  for (const part of ["cat a | head", "cat $f", 'grep "$x" .', "cat *.ts", "cat a > b", "cat 'a"]) assert.equal(shellWords(part), undefined, part);
});

test("a file view gives the read parameters", () => {
  const spec = (part: string) => readSpec(shellWords(part)!);
  assert.deepEqual(spec("cat a.ts"), { path: "a.ts" });
  assert.deepEqual(spec("bat -p a.ts"), { path: "a.ts" });
  assert.deepEqual(spec("head a.ts"), { path: "a.ts", limit: 10 });
  assert.deepEqual(spec("head -n 40 a.ts"), { path: "a.ts", limit: 40 });
  assert.deepEqual(spec("head -5 a.ts"), { path: "a.ts", limit: 5 });
  assert.deepEqual(spec("tail -n 20 a.log"), { path: "a.log", offset: -20 });
  assert.deepEqual(spec("tail -n +7 a.log"), { path: "a.log", offset: 7 });
  assert.deepEqual(spec("sed -n '10,30p' a.ts"), { path: "a.ts", offset: 10, limit: 21 });
  assert.deepEqual(spec("sed -n 5p a.ts"), { path: "a.ts", offset: 5, limit: 1 });
  assert.deepEqual(spec("sed -n '5,$p' a.ts"), { path: "a.ts", offset: 5 });
  for (const part of ["cat a b", "cat -A a", "cat", "head -c 9 a", "tail -f a", "sed -i s/a/b/ a", "sed -n '/x/p' a", "ls a"])
    assert.equal(spec(part), undefined, part);
});

test("grep and rg give the grep parameters, and an unknown option runs as written", () => {
  const spec = (part: string) => grepSpec(shellWords(part)!);
  assert.deepEqual(spec("grep -rn foo src"), { params: { pattern: "foo", noIgnore: true }, target: "src" });
  assert.deepEqual(spec("grep -rli --include='*.ts' -C2 foo ."), {
    params: { pattern: "foo", ignoreCase: true, filesOnly: true, noIgnore: true, glob: "*.ts", context: 2 },
    target: ".",
  });
  assert.deepEqual(spec("grep -E 'a|b' f"), { params: { pattern: "a|b", noIgnore: true }, target: "f" });
  assert.deepEqual(spec("rg -n -g '*.ts' -t ts foo"), { params: { pattern: "foo", glob: "*.ts", type: "ts" }, target: "." });
  assert.deepEqual(spec("rg -e -x src"), { params: { pattern: "-x" }, target: "src" });
  for (const part of ["grep foo", "grep -v foo f", "grep -A3 foo f", "grep 'a|b' f", "grep 'a\\|b' f", "rg -w foo", "rg foo a b", "grep -lc x f"])
    assert.equal(spec(part), undefined, part);
});

test("a read part gets the form of the read tool", () => {
  const route = fileRoute("sed -n 2,3p a.ts")!;
  assert.equal(route.command, "cat -- a.ts");
  assert.equal(route.format!("1\n2\n3\n4", 0), "2\n3\n\n[Showing lines 2-3 of 4. Use offset=4 to continue.]");
  assert.match(fileRoute("sed -n 9p a.ts")!.format!("1\n2", 0), /offset 9 is beyond the end of a\.ts/);
  assert.equal(route.format!("cat: a.ts: No such file", 1), "cat: a.ts: No such file");
  assert.deepEqual(route.tool, { name: "read", args: { path: "a.ts", offset: 2, limit: 2 } });
});

test("a heredoc into cat or tee, or an echo into a file, gives the write parameters", () => {
  assert.deepEqual(writeSpec("cat > a.ts <<'EOF'\nx = $y\n\nEOF"), { path: "a.ts", content: "x = $y\n\n" });
  assert.deepEqual(writeSpec("cat <<EOF >'my file'\nplain\nEOF"), { path: "my file", content: "plain\n" });
  assert.deepEqual(writeSpec("cat > a <<-EOF\n\tin\n\tEOF"), { path: "a", content: "in\n" });
  assert.deepEqual(writeSpec('tee a >/dev/null <<"EOF"\nt\nEOF'), { path: "a", content: "t\n" });
  assert.deepEqual(writeSpec("echo 'a b' c > out.txt"), { path: "out.txt", content: "a b c\n" });
  assert.deepEqual(fileRoute("echo x > a"), { tool: { name: "write", args: { path: "a", content: "x\n" } } });
});

test("a write that the write tool cannot express runs as written", () => {
  for (const part of [
    "cat >> a <<'EOF'\nx\nEOF",
    "cat > a <<EOF\n$HOME\nEOF",
    "cat > a 2>/dev/null <<'EOF'\nx\nEOF",
    "cat > a <<'EOF'\nx\nEOF\nmore",
    "cat > a",
    'echo "<<EOF" > a',
    "echo -e 'a\\n' > a",
    "echo x &> a",
    "echo x >| a",
    "echo $x > a",
    "tee -a a <<'EOF'\nx\nEOF",
    "tee a <<'EOF'\nx\nEOF\n",
    "sort > a <<'EOF'\nx\nEOF",
  ])
    assert.equal(writeSpec(part), undefined, part);
});

const match = (path: string, line: number, text: string) =>
  JSON.stringify({ type: "match", data: { path: { text: path }, line_number: line, lines: { text } } });

test("a grep part gets the form of the grep tool", () => {
  const route = fileRoute("grep -rn foo src")!;
  assert.equal(route.command, "rg --no-config --hidden --glob '!.git' --sort path --color never --line-number --with-filename --json --no-ignore -- foo src");
  const many = Array.from({ length: 25 }, (_, i) => match("src/a.ts", i + 1, "foo"));
  const out = route.format!([match("src/b/c.ts", 3, "x foo"), ...many, "rg: src/x: Permission denied"].join("\n"), 2);
  const lines = out.split("\n");
  assert.equal(lines[0], "b/c.ts:3: x foo");
  assert.equal(lines.filter((l) => l.startsWith("a.ts:")).length, 20);
  assert.match(out, /\[Max 20 matches per file in: a\.ts\. Search that file for more\.\]\n\n\[rg errors: rg: src\/x: Permission denied\]$/);
  assert.equal(route.format!("", 1), "No matches found");
  assert.equal(route.format!("rg: bad regex", 2), "rg: bad regex");
});

test("a grep on one file keeps all matches and the path as given", () => {
  const route = fileRoute("rg foo a.ts")!;
  const out = route.format!(Array.from({ length: 25 }, (_, i) => match("a.ts", i + 1, "foo")).join("\n"), 0);
  assert.equal(out.split("\n").length, 25);
  assert.equal(out.split("\n")[0], "a.ts:1: foo");
});
