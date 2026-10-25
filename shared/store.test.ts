import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { callNumber, freeId, outFile, sessionDir, shorten, storeDir } from "./store.ts";

const ctx = (file: string | undefined, branch: unknown[] = []) => ({ sessionManager: { getSessionFile: () => file, getBranch: () => branch } }) as any;

test("freeId keeps a free number and adds a suffix to a taken one", () => {
  assert.equal(
    freeId("3.2-C1", () => false),
    "3.2-C1",
  );
  const taken = new Set(["3.2-C1", "3.2-C1-2"]);
  assert.equal(
    freeId("3.2-C1", (id) => taken.has(id)),
    "3.2-C1-3",
  );
});

test("sessionDir is the session file without .jsonl, and fails without a session", () => {
  assert.equal(sessionDir(ctx("/s/2026_x.jsonl")), "/s/2026_x");
  assert.throws(() => sessionDir(ctx(undefined)), /no session file/);
});

test("callNumber is <user turn>.<assistant round>-C<call index>", () => {
  const branch = [
    { type: "message", message: { role: "user", content: "hi" } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "a" }] } },
    { type: "message", message: { role: "toolResult" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text" }, { type: "toolCall", id: "b" }, { type: "toolCall", id: "c" }] } },
    { type: "message", message: { role: "user", content: "again" } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "d" }] } },
  ];
  const c = ctx("/s/x.jsonl", branch);
  assert.equal(callNumber(c, "a"), "1.1-C1");
  assert.equal(callNumber(c, "c"), "1.2-C2");
  assert.equal(callNumber(c, "d"), "2.1-C1");
  assert.equal(callNumber(c, "toolu_0123456789"), "x-23456789");
});

test("storeDir and outFile create <session>/out and <session>/jobs and number the files", () => {
  const root = mkdtempSync(join(tmpdir(), "store-"));
  try {
    const c = ctx(join(root, "s.jsonl"), [
      { type: "message", message: { role: "user", content: "hi" } },
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "a" }] } },
    ]);
    assert.equal(storeDir(c, "out"), join(root, "s", "out"));
    assert.equal(storeDir(c, "jobs"), join(root, "s", "jobs"));
    assert.ok(existsSync(join(root, "s", "jobs")));
    assert.equal(outFile(c, "a", "bash"), join(root, "s", "out", "1.1-C1.bash.log"));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("shorten replaces the home directory", () => {
  assert.equal(shorten(`${homedir()}/a`), "~/a");
  assert.equal(shorten("/tmp/a"), "/tmp/a");
});
