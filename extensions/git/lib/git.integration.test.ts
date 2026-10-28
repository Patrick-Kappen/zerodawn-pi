import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { registerGit } from "./git.ts";

const root = mkdtempSync(join(tmpdir(), "git-tool-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("a large git result goes to a file that the model gets as out:<name>", async () => {
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  git("init", "-q");
  writeFileSync(join(repo, "a.txt"), `${"x".repeat(80)}\n`.repeat(100));
  git("add", ".");
  git("commit", "-qm", "add");
  let tool: any;
  registerGit({ registerTool: (t: any) => (tool = t), on() {} } as any);
  const session = join(root, "2026-10-27T09-21-57-511Z_01a17caa-9907-7437-aa19-54145f7d36c4");
  const ctx = {
    cwd: repo,
    sessionManager: { getSessionFile: () => `${session}.jsonl`, getBranch: () => [] },
  };
  const r = await tool.execute("call-1", { action: "show", paths: ["a.txt"] }, undefined, undefined, ctx);
  const text = r.content[0].text as string;
  const ref = text.match(/log: (out:\S+) /)?.[1];
  assert.match(ref ?? "", /^out:x-call-1\.git$/);
  assert.match(readFileSync(join(session, "out", `${ref!.slice(4)}.log`), "utf8"), /x{80}/);
});
