import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileRoute } from "./route.ts";

const dir = mkdtempSync(join(tmpdir(), "files-route-"));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, "src"));
writeFileSync(join(dir, "src/a.ts"), Array.from({ length: 30 }, (_, i) => `const foo${i} = ${i};`).join("\n"));
writeFileSync(join(dir, "src/b.ts"), "export const bar = 1;\nconst foo = bar;\n");

function run(part: string): string {
  const route = fileRoute(part);
  if (!route?.format) throw new Error(`no route for ${part}`);
  const r = spawnSync("bash", ["-c", route.command], { cwd: dir, encoding: "utf8" });
  return route.format((r.stdout + r.stderr).replace(/\n+$/, ""), r.status ?? -1);
}

test("a file view in the shell gets the form of the read tool", () => {
  assert.equal(run("tail -n 2 src/a.ts"), "const foo28 = 28;\nconst foo29 = 29;");
  assert.equal(run("head -n 1 src/b.ts"), "export const bar = 1;\n\n[Showing lines 1-1 of 2. Use offset=2 to continue.]");
  assert.match(run("cat src/none.ts"), /No such file/);
});

test("a search in the shell gets the form of the grep tool", () => {
  const out = run("grep -rn foo .").split("\n");
  assert.equal(out.filter((l) => l.startsWith("src/a.ts:")).length, 20);
  assert.equal(out[20], "src/b.ts:2: const foo = bar;");
  assert.equal(run("rg -c foo src"), "a.ts:30\nb.ts:1");
  assert.equal(run("rg bar src/b.ts"), "src/b.ts:1: export const bar = 1;\nsrc/b.ts:2: const foo = bar;");
  assert.equal(run("rg nothing src"), "No matches found");
});
