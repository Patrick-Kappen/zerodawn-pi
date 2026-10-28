import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { GREP_PER_FILE, registerGrep, rgArgs } from "./grep.ts";
import { registerRead } from "./read.ts";

const dir = mkdtempSync(join(tmpdir(), "grep-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const put = (path: string, text: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};
put(".gitignore", "node_modules\n");
put(".git/HEAD", "needle in git\n");
put("b.ts", "one\nneedle b\n");
put("a.ts", "needle a\n");
put(".hidden.ts", "needle hidden\n");
put("node_modules/x/index.js", "needle module\n");
put("many.txt", Array.from({ length: 30 }, (_, i) => `needle ${i + 1}`).join("\n"));

let tool: any;
registerGrep({ registerTool: (t: any) => (tool = t) } as any, dir);
const grep = async (params: Record<string, unknown>) =>
  (await tool.execute("id", { pattern: "needle", ...params }, undefined, undefined, { cwd: dir })).content[0].text as string;

test("grep searches hidden files sorted by path, skips .git and ignored files, and caps matches per file", async () => {
  const text = await grep({ glob: "!many.txt" });
  assert.equal(text, ".hidden.ts:1: needle hidden\na.ts:1: needle a\nb.ts:2: needle b");
  const many = await grep({ path: ".", glob: "many.txt" });
  assert.equal(many.split("\n").filter((l) => l.startsWith("many.txt:")).length, GREP_PER_FILE);
  assert.match(many, /\[Max 20 matches per file in: many\.txt\. Search that file for more\.\]/);
});

test("grep with noIgnore finds ignored files; type, filesOnly and count shape the result", async () => {
  assert.match(await grep({ noIgnore: true, type: "js" }), /^node_modules\/x\/index\.js:1: needle module$/);
  assert.equal(await grep({ filesOnly: true, glob: "*.ts" }), ".hidden.ts\na.ts\nb.ts");
  assert.equal(await grep({ count: true, glob: "*.ts" }), ".hidden.ts:1\na.ts:1\nb.ts:1");
});

test("grep on one file has no per-file cap, gives context lines, and names a reached limit", async () => {
  assert.equal((await grep({ path: "many.txt" })).split("\n").length, 30);
  assert.equal(await grep({ path: "b.ts", context: 1 }), "b.ts-1- one\nb.ts:2: needle b");
  assert.match(await grep({ path: "many.txt", limit: 5 }), /^(many\.txt:\d+: needle \d+\n){5}\n\[Limit of 5 lines reached/);
});

test("grep reports no match, and fails loud on a missing path, a bad pattern and conflicting options", async () => {
  assert.equal(await grep({ pattern: "absent-text" }), "No matches found");
  await assert.rejects(grep({ path: "nope" }), /grep: path nope does not exist/);
  await assert.rejects(grep({ pattern: "(" }), /grep: rg exited with code 2: .*regex/s);
  assert.throws(() => rgArgs({ pattern: "x", filesOnly: true, count: true }, true), /filesOnly or count, not both/);
});

test("grep and read take out:<name> as the path of a session output", async () => {
  const session = join(dir, "2026-10-27T09-21-57-511Z_01a17caa-9907-7437-aa19-54145f7d36c4");
  put(`${session.slice(dir.length + 1)}/out/5.1-C1.bash.txt`, "a\nneedle out\n");
  const ctx = { cwd: dir, sessionManager: { getSessionFile: () => `${session}.jsonl`, buildSessionProjection: () => ({ entries: [] }) } };
  const r = await tool.execute("id", { pattern: "needle", path: "out:5.1-C1.bash" }, undefined, undefined, ctx);
  assert.equal(r.content[0].text, "out:5.1-C1.bash:2: needle out");
  let read: any;
  registerRead({ registerTool: (t: any) => (read = t) } as any, dir);
  const text = (await read.execute("id", { path: "out:5.1-C1.bash", offset: -1 }, undefined, undefined, ctx)).content[0].text;
  assert.match(text, /needle out/);
});
