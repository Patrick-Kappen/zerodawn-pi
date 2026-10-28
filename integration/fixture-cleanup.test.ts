import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("filesystem and job fixtures remove their temporary directories", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-fixture-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixtures = join(root, "fixtures");
  const runtime = join(root, "runtime");
  mkdirSync(fixtures);
  mkdirSync(runtime);
  const files = [
    "./extensions/bash/tool/jobproc.test.ts",
    "./extensions/files/lib/files.test.ts",
    "./extensions/files/lib/format.test.ts",
    "./extensions/files/lib/grep.test.ts",
    "./extensions/files/lib/read.test.ts",
    "./extensions/files/lib/syntax.test.ts",
    "./extensions/handoff/index.test.ts",
    "./extensions/handoff/lib/lib.test.ts",
  ];
  const result = spawnSync(process.execPath, ["test", ...files], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, TMPDIR: fixtures, XDG_RUNTIME_DIR: runtime },
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(fixtures), [], "integration fixtures must remove temporary files after the test process exits");
});
