import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerFiles } from "./files.ts";
import { checked, language, newErrors, syntaxErrors } from "./syntax.ts";

const nvim = { nvim: "nvim" };
const good = "local x = 1\nreturn x\n";
const tmp = () => mkdtempSync(join(tmpdir(), "syntax-"));

test("language by file name", () => {
  assert.equal(language("a/b.ts"), "typescript");
  assert.equal(language("x.tsx"), "tsx");
  assert.equal(language("flake.nix"), "nix");
  assert.equal(language("README.md"), undefined);
});

test("nvim finds a syntax error with its line", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "a.lua"), "local x = = 1\n");
  const [errors] = await syntaxErrors(nvim, "lua", [join(dir, "a.lua")], "a.lua");
  assert.equal(errors.length > 0, true);
  assert.equal(errors[0].line, 1);
});

test("only errors that the old content did not have count", () => {
  const e = (text: string) => ({ line: 1, kind: "syntax error", text });
  assert.deepEqual(newErrors([e("a")], [e("a"), e("b")]), [e("b")]);
  assert.deepEqual(newErrors([e("a"), e("a")], [e("a")]), []);
});

test("a change that adds a syntax error is undone and fails with the lines", async () => {
  const dir = tmp();
  const file = join(dir, "a.lua");
  writeFileSync(file, good);
  await assert.rejects(
    checked(nvim, file, "a.lua", async () => writeFileSync(file, "local x = = 1\nreturn x\n")),
    /a\.lua: the change adds 1 syntax error\(s\), so it was undone[\s\S]*line 1: [\s\S]*1\| local x = = 1/,
  );
  assert.equal(readFileSync(file, "utf8"), good);
  const created = join(dir, "new.lua");
  await assert.rejects(
    checked(nvim, created, "new.lua", async () => writeFileSync(created, "if then\n")),
    /undone/,
  );
  assert.equal(existsSync(created), false);
});

test("an old error does not block a change; a file type without a parser rule is not checked", async () => {
  const dir = tmp();
  const file = join(dir, "a.lua");
  writeFileSync(file, "local x = = 1\n");
  await checked(nvim, file, "a.lua", async () => writeFileSync(file, "local x = = 1\nlocal y = 2\n"));
  const md = join(dir, "a.md");
  await checked({ nvim: "/no/nvim" }, md, "a.md", async () => writeFileSync(md, "# x"));
  assert.equal(readFileSync(md, "utf8"), "# x");
});

test("a missing nvim or parser fails loud with the Home Manager option", async () => {
  const dir = tmp();
  const file = join(dir, "a.lua");
  writeFileSync(file, good);
  await assert.rejects(
    checked({ nvim: "/no/nvim" }, file, "a.lua", async () => {}),
    /nvim not found at "\/no\/nvim"\. Set programs\.zerodawn-pi\.nvim/,
  );
  await assert.rejects(syntaxErrors(nvim, "nolang", [file], "a.x"), /syntax check of a\.x: no tree-sitter parser for nolang[\s\S]*treesitterGrammars/);
});

test("the edit tool undoes an edit with a syntax error", async () => {
  const tools = new Map<string, any>();
  registerFiles({ registerTool: (t: any) => tools.set(t.name, t) } as any, nvim);
  const edit = tools.get("edit");
  const dir = tmp();
  writeFileSync(join(dir, "a.lua"), good);
  await assert.rejects(
    edit.execute("e", { path: "a.lua", edits: [{ oldText: "local x = 1", newText: "local x = = 1" }] }, undefined, undefined, { cwd: dir }),
    /syntax error/,
  );
  assert.equal(readFileSync(join(dir, "a.lua"), "utf8"), good);
});
