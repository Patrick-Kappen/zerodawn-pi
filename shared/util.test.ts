import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { absolutePath, age, argSummary, commandLine, stripQuoted, textOf } from "./util.ts";

test("age formats seconds and minutes", () => {
  assert.equal(age(0), "0s");
  assert.equal(age(59_400), "59s");
  assert.equal(age(65_000), "1m05s");
  assert.equal(age(3_600_000), "60m00s");
});

test("commandLine joins whitespace and cuts at max", () => {
  assert.equal(commandLine("ls  -la\n  | wc"), "ls -la | wc");
  assert.equal(commandLine("abcdef", 3), "abc");
});

test("absolutePath resolves ~, @ and relative paths against cwd", () => {
  assert.equal(absolutePath("/a/b", "/cwd"), "/a/b");
  assert.equal(absolutePath("x/y", "/cwd"), "/cwd/x/y");
  assert.equal(absolutePath("~/x", "/cwd"), `${homedir()}/x`);
  assert.equal(absolutePath("@src/a.ts", "/cwd"), "/cwd/src/a.ts");
  assert.equal(absolutePath("@src/a.ts", "/cwd", { toolPath: false }), "/cwd/@src/a.ts");
});

test("textOf joins text blocks and refuses other content", () => {
  assert.equal(
    textOf([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]),
    "ab",
  );
  assert.equal(textOf([{ type: "text", text: "a" }, { type: "image" }]), undefined);
  assert.equal(textOf([]), "");
});

test("stripQuoted replaces quoted strings and heredoc bodies", () => {
  assert.equal(stripQuoted("echo 'a b' \"c d\""), "echo Q Q");
  assert.equal(stripQuoted('echo "a \\" b"'), "echo Q");
  assert.equal(stripQuoted("cat <<EOF\ngit status\nEOF\nls"), "cat <<H\nls");
  assert.equal(stripQuoted("cat <<'EOF' > f\nx\nEOF"), "cat <<H > f");
});

test("argSummary picks the first known key, shortens home and falls back to JSON", () => {
  assert.equal(argSummary({ command: "ls   -la" }), "ls -la");
  assert.equal(argSummary({ path: `${homedir()}/x/y` }), "~/x/y");
  assert.equal(argSummary({ other: 1 }), '{"other":1}');
  assert.equal(argSummary({ command: "abcdef" }, 3), "abc");
  assert.equal(argSummary(null), "");
  assert.equal(argSummary("x"), "");
});
