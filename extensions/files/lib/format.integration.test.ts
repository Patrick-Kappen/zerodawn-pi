import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { registerFiles } from "./files.ts";
import { formatterFor, runFormatter } from "./format.ts";

const SPACES = '#!/bin/sh\nfor f; do :; done\nsed -i "s/ *: */: /" "$f"\n';

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "format-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".git"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
    if (name.includes("bin/")) chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

function withPath<T>(path: string, run: () => T): T {
  const old = process.env.PATH;
  process.env.PATH = path;
  try {
    return run();
  } finally {
    process.env.PATH = old;
  }
}

test("biome of the project formats the file, and the note says so", async () => {
  const dir = project({ "biome.json": "{}", "node_modules/.bin/biome": SPACES, "src/a.css": "a{color   :red}\n" });
  const file = join(dir, "src/a.css");
  const f = formatterFor(file)!;
  assert.equal(f.name, "biome");
  assert.equal(f.cwd, dir);
  assert.match((await runFormatter(f, file, "a.css"))!, /^Formatted with biome/);
  assert.equal(readFileSync(file, "utf8"), "a{color: red}\n");
  assert.equal(await runFormatter(f, file, "a.css"), undefined);
});

test("no formatter config: no formatter", () => {
  const dir = project({ "a.ts": "x", "flake.nix": "{ }", "b.nix": "{}", "c.py": "x" });
  for (const f of ["a.ts", "b.nix", "c.py"]) assert.equal(formatterFor(join(dir, f)), undefined, f);
});

test("nixfmt in the root flake and ruff in pyproject.toml are found on PATH", () => {
  const dir = project({ "flake.nix": "formatter = pkgs.nixfmt-tree;", "pyproject.toml": "[tool.ruff]\n", "bin/nixfmt": SPACES, "bin/ruff": SPACES });
  withPath(join(dir, "bin"), () => {
    assert.deepEqual(formatterFor(join(dir, "a.nix")), { name: "nixfmt", bin: "nixfmt", args: [join(dir, "a.nix")], cwd: dir });
    assert.equal(formatterFor(join(dir, "a.py"))?.name, "ruff");
  });
});

test("a configured formatter that is missing fails before the change", async () => {
  const dir = project({ "biome.json": "{}", "a.css": "a{}\n" });
  assert.throws(
    () => withPath(dir, () => formatterFor(join(dir, "a.css"))),
    /sets biome as the formatter, but biome is not found .* The file did not change\./,
  );
});

test("a failing formatter fails loud after the change", async () => {
  const dir = project({ "biome.json": "{}", "node_modules/.bin/biome": "#!/bin/sh\necho broken >&2\nexit 1\n", "a.css": "a{}\n" });
  const file = join(dir, "a.css");
  await assert.rejects(runFormatter(formatterFor(file)!, file, "a.css"), /a\.css: the change is applied, but biome failed: broken/);
});

test("the edit tool formats after the edit and shows the formatted lines", async () => {
  const dir = project({ "biome.json": "{}", "node_modules/.bin/biome": SPACES, "a.css": "a{}\nb{}\n" });
  const tools = new Map<string, any>();
  registerFiles({ registerTool: (t: any) => tools.set(t.name, t) } as any, { nvim: "nvim" });
  const r = await tools.get("edit").execute("e", { path: "a.css", edits: [{ oldText: "b{}", newText: "b{x   :1}" }] }, undefined, undefined, { cwd: dir });
  assert.equal(readFileSync(join(dir, "a.css"), "utf8"), "a{}\nb{x: 1}\n");
  assert.match(r.content.map((c: any) => c.text).join("\n"), /Formatted with biome/);
});
