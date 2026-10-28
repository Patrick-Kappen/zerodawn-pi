import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeRegister } from "./register.ts";

test("writeRegister creates the dir and replaces the file without a temp file left", async () => {
  const root = await mkdtemp(join(tmpdir(), "reg-"));
  try {
    const dir = join(root, "nested");
    await writeRegister(dir, []);
    await writeRegister(dir, [{ id: "a", role: "scout", window: "@1", status: "running", base: "abc" }]);
    assert.deepEqual(JSON.parse(await readFile(join(dir, "register.json"), "utf8")), {
      agents: [{ id: "a", role: "scout", window: "@1", status: "running", base: "abc" }],
    });
    assert.deepEqual(await readdir(dir), ["register.json"]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("writeRegister names the path on failure", async () => {
  await assert.rejects(writeRegister("/proc/nope/x", []), /could not write "\/proc\/nope\/x\/register.json"/);
});
