import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerFiles } from "./files.ts";

function load() {
  const tools = new Map<string, any>();
  registerFiles({ registerTool: (t: any) => tools.set(t.name, t) } as any);
  return { tools };
}

test("edit and write store the lines they put in context", async () => {
  const { tools } = load();
  const dir = mkdtempSync(join(tmpdir(), "files-"));
  const ctx = { cwd: dir };
  const w = await tools.get("write").execute("w", { path: "a.ts", content: "a\nb\nc\n" }, undefined, undefined, ctx);
  assert.deepEqual(w.details.seen.path, join(dir, "a.ts"));
  assert.deepEqual(w.details.seen.ranges[0].from, 1);
  assert.equal(w.details.seen.ranges[0].hashes.length, 3);
  writeFileSync(join(dir, "b.ts"), `${Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n")}\n`);
  const e = await tools.get("edit").execute("e", { path: "b.ts", edits: [{ oldText: "l10", newText: "x10" }] }, undefined, undefined, ctx);
  assert.deepEqual(e.details.seen.ranges[0].from, 8);
  assert.equal(e.details.seen.ranges[0].hashes.length, 7);
});
