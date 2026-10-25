import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CONFIG_FILE, readConfig } from "./config.ts";

test("config.json lives next to package.json", () => {
  assert.equal(CONFIG_FILE, join(import.meta.dirname, "..", "config.json"));
});

test("readConfig: missing file is empty, valid values pass, wrong values fail with the path", () => {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  const file = join(dir, "config.json");
  try {
    assert.deepEqual(readConfig(file), {});
    writeFileSync(file, JSON.stringify({ astGrep: "/bin/ast-grep", nixosRepo: "/repo" }));
    assert.deepEqual(readConfig(file), { astGrep: "/bin/ast-grep", nixosRepo: "/repo" });
    writeFileSync(file, JSON.stringify({ astGrep: 3 }));
    assert.throws(() => readConfig(file), new RegExp(`cannot read ${file}: ${file}: "astGrep" must be a non-empty string`));
    writeFileSync(file, "[]");
    assert.throws(() => readConfig(file), /is not a JSON object/);
    writeFileSync(file, "{");
    assert.throws(() => readConfig(file), /cannot read .*config.example.json/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
