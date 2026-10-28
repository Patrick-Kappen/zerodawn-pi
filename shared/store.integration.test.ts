import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { callFileId, callNumber, callOutFile, freeId, outFile, outRef, resolveOutRef, sessionDir, shorten, storeDir } from "./store.ts";

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
  assert.equal(callFileId(c, "c"), "1.2-C2");
  assert.equal(callFileId(c, "c/3"), "1.2-C2.3");
  assert.equal(callFileId(c, "c/a b/../x"), "1.2-C2.a_b....x");
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
    assert.equal(callOutFile(c, "a/2", "git"), join(root, "s", "out", "1.1-C1.2.git.log"));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("shorten replaces the home directory", () => {
  assert.equal(shorten(`${homedir()}/a`), "~/a");
  assert.equal(shorten("/tmp/a"), "/tmp/a");
});

test("outRef names a session output as out:<name>; resolveOutRef finds its .txt, else its .log", () => {
  const root = mkdtempSync(join(tmpdir(), "store-ref-"));
  const session = join(root, "2026-10-27T09-21-57-511Z_01a17caa-9907-7437-aa19-54145f7d36c4");
  mkdirSync(join(session, "out"), { recursive: true });
  writeFileSync(join(session, "out", "3.2-C1.bash.log"), "raw");
  writeFileSync(join(session, "out", "4.1-C1.check.log"), "raw");
  writeFileSync(join(session, "out", "3.2-C1.bash.txt"), "clean");
  assert.equal(outRef(join(session, "out", "3.2-C1.bash.txt")), "out:3.2-C1.bash");
  assert.equal(outRef(join(root, "out", "x.log")), shorten(join(root, "out", "x.log")));
  const c = ctx(`${session}.jsonl`);
  assert.equal(resolveOutRef(c, "out:3.2-C1.bash"), join(session, "out", "3.2-C1.bash.txt"));
  assert.equal(resolveOutRef(c, "out:4.1-C1.check"), join(session, "out", "4.1-C1.check.log"));
  assert.equal(resolveOutRef(c, "src/a.ts"), undefined);
  assert.throws(() => resolveOutRef(c, "out:9.9-C1.bash"), /out:9\.9-C1\.bash is not an output of this session .*Run jobs list/);
  rmSync(root, { recursive: true, force: true });
});
