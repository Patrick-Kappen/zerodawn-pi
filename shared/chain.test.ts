import assert from "node:assert/strict";
import { test } from "node:test";
import { splitChain } from "./chain.ts";

const texts = (command: string) => splitChain(command)?.map((p) => p.text.trim());

test("a chain splits at &&, ||, ;, & and new lines, and joins back to the command", () => {
  const command = "cd ~/x && git status --short | head; git log -3 || echo no\nsleep 1 & cat a";
  const parts = splitChain(command)!;
  assert.deepEqual(
    parts.map((p) => [p.text.trim(), p.sep]),
    [
      ["cd ~/x", "&&"],
      ["git status --short | head", ";"],
      ["git log -3", "||"],
      ["echo no", "\n"],
      ["sleep 1", "&"],
      ["cat a", ""],
    ],
  );
  assert.equal(parts.map((p) => p.text + p.sep).join(""), command);
});

test("quotes, redirections and pipes do not split", () => {
  assert.deepEqual(texts(`echo 'a && b; c' "d || e" && grep -n x f 2>&1 |& cat &>/dev/null`), [
    "echo 'a && b; c' \"d || e\"",
    "grep -n x f 2>&1 |& cat &>/dev/null",
  ]);
});

test("loops, if, case, groups, subshells and command substitution stay in one part", () => {
  assert.deepEqual(texts("for f in *.md; do cat $f; done && echo ok"), ["for f in *.md; do cat $f; done", "echo ok"]);
  assert.deepEqual(texts("if [ -f a ]; then cat a; else echo no; fi; ls"), ["if [ -f a ]; then cat a; else echo no; fi", "ls"]);
  assert.deepEqual(texts("case $x in a) echo 1;; *) echo 2;; esac; ls"), ["case $x in a) echo 1;; *) echo 2;; esac", "ls"]);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash variable, not a template placeholder
  assert.deepEqual(texts("{ cat a; cat b; } | head; ( cd x && ls ); echo $(date; id) ${HOME}"), [
    "{ cat a; cat b; } | head",
    "( cd x && ls )",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash variable, not a template placeholder
    "echo $(date; id) ${HOME}",
  ]);
});

test("a heredoc body stays with the line that opened it, and a comment ends at its line", () => {
  assert.deepEqual(texts("cat > f <<'EOF'\na && b; c\nEOF\ngit log # raw-git && x\nls"), ["cat > f <<'EOF'\na && b; c\nEOF", "git log # raw-git && x", "ls"]);
  assert.deepEqual(texts("cat <<-EOF\n\tx\n\tEOF"), ["cat <<-EOF\n\tx\n\tEOF"]);
  assert.deepEqual(texts("tr a b <<< 'x; y' && ls"), ["tr a b <<< 'x; y'", "ls"]);
});

test("an open quote, block or heredoc gives undefined", () => {
  for (const command of ["echo 'a", 'echo "a', "for f in a; do ls", "cat <<EOF\nx", "( ls", "echo ${x"]) assert.equal(splitChain(command), undefined, command);
});
