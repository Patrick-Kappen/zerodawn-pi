import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CONFIG_ENV, CONFIG_FILE, configFile, handoffModels, readConfig, subagentModels } from "./config.ts";

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

test("readConfig: subagentExtensions accepts absolute paths and an empty list, rejects the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  const file = join(dir, "config.json");
  try {
    writeFileSync(file, JSON.stringify({ subagentExtensions: ["/a/index.ts", "/b/index.ts"] }));
    assert.deepEqual(readConfig(file), { subagentExtensions: ["/a/index.ts", "/b/index.ts"] });
    writeFileSync(file, JSON.stringify({ subagentExtensions: [] }));
    assert.deepEqual(readConfig(file), { subagentExtensions: [] });
    for (const bad of ["/a", ["a/index.ts"], [3], [""], {}]) {
      writeFileSync(file, JSON.stringify({ subagentExtensions: bad }));
      assert.throws(() => readConfig(file), new RegExp(`${file}: "subagentExtensions" must be an array of absolute paths`));
    }
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("readConfig: a config with only the old keys reads unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  const file = join(dir, "config.json");
  try {
    writeFileSync(file, JSON.stringify({ astGrep: "/bin/ast-grep" }));
    assert.deepEqual(readConfig(file), { astGrep: "/bin/ast-grep" });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("configFile: without ZERODAWN_PI_CONFIG it is the file next to package.json", () => {
  assert.equal(configFile({}), CONFIG_FILE);
});

test("configFile: ZERODAWN_PI_CONFIG points to another absolute file, a relative path fails", () => {
  assert.equal(configFile({ [CONFIG_ENV]: "/etc/pi/config.json" }), "/etc/pi/config.json");
  assert.throws(() => configFile({ [CONFIG_ENV]: "config.json" }), /must be an absolute path/);
});

test("subagentModels: returns the list, fails with the file and key when missing, empty or wrong", () => {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  const file = join(dir, "config.json");
  try {
    assert.throws(() => subagentModels(file), new RegExp(`${file} needs "subagentModels"`));
    for (const bad of [[], "a/b", [3], [""]]) {
      writeFileSync(file, JSON.stringify({ subagentModels: bad }));
      assert.throws(() => subagentModels(file), new RegExp(`${file} needs "subagentModels"`));
    }
    writeFileSync(file, JSON.stringify({ subagentModels: ["a/b:low", "c/d"] }));
    assert.deepEqual(subagentModels(file), ["a/b:low", "c/d"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("handoffModels: returns the list, fails with the file and key when missing or wrong", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-handoff-"));
  const file = join(dir, "config.json");
  try {
    writeFileSync(file, "{}");
    assert.throws(() => handoffModels(file), new RegExp(`${file} needs "handoffModels"`));
    writeFileSync(file, JSON.stringify({ handoffModels: [] }));
    assert.throws(() => handoffModels(file), /needs "handoffModels"/);
    writeFileSync(file, JSON.stringify({ handoffModels: ["local/q", "p/m:low"] }));
    assert.deepEqual(handoffModels(file), ["local/q", "p/m:low"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
