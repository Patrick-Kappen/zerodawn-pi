import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, resultText, spawnJob, summarizeFromDisk, tailLimit } from "./jobproc.ts";

function run(command: string, limit = 10): Promise<{ code: number | null; sig: string | null; dir: string; log: string; status: string }> {
  const dir = mkdtempSync(join(tmpdir(), "bash-jobs-"));
  const commandFile = join(dir, "job.sh");
  writeFileSync(commandFile, `${command}\n`);
  const log = join(dir, "job.log");
  const status = join(dir, "job.status");
  const child = spawnJob({ commandFile, status, limit, log, cwd: dir });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, sig) => resolve({ code, sig, dir, log, status }));
  });
}

test("a job runs in a pty, keeps colors and reports its exit code", async () => {
  const r = await run('tty | grep -q /dev/pts && echo pty-ok; printf "\\e[32mok\\e[0m\\n"; printf "a\\rb\\n"; exit 3');
  assert.equal(r.code, 3);
  assert.equal(readFileSync(r.status, "utf8").trim(), "3");
  const out = render(r.log, 1 << 20);
  assert.deepEqual(out.plain, ["pty-ok", "ok", "b"]);
  assert.match(out.lines[1], /\x1b\[32mok\x1b\[0m/);
  assert.equal(resultText(r.log, "exit 3 (1s)"), "exit 3 (1s)\npty-ok\nok\nb");
});

test("the time limit kills the whole job", async () => {
  const r = await run("echo start; sleep 20; echo never", 1);
  assert.equal(r.sig, "SIGTERM");
  assert.equal(existsSync(r.status), false);
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(render(r.log, 1 << 20).plain, ["start"]);
});

test("summarizeFromDisk reads the exit code from the script footer when the status file is gone", async () => {
  const r = await run("echo hi; exit 5");
  const meta = { id: "x", command: "echo hi", log: r.log, status: join(r.dir, "missing"), start: Date.now(), limit: 0, bg: true, reported: false };
  assert.equal(summarizeFromDisk(meta), "exit 5\nhi");
});

test("tailLimit keeps the last lines inside both limits", () => {
  const lines = ["a", "bb", "ccc", "dddd"];
  assert.deepEqual(tailLimit(lines, 10, 1000), { kept: lines, truncated: false });
  assert.deepEqual(tailLimit(lines, 2, 1000), { kept: ["ccc", "dddd"], truncated: true });
  assert.deepEqual(tailLimit(lines, 10, 9), { kept: ["ccc", "dddd"], truncated: true });
  assert.deepEqual(tailLimit([], 10, 10), { kept: [], truncated: false });
});

test("long output returns a tail and the log path", async () => {
  const r = await run("seq 1 3000");
  const text = resultText(r.log, "exit 0 (1s)");
  const lines = text.split("\n");
  assert.match(lines[0], /^exit 0 \(1s\) · 3000 lines, \d+ bytes · last 2000 lines:$/);
  assert.equal(lines[1], "1001");
  assert.equal(lines[lines.length - 2], "3000");
  assert.match(lines[lines.length - 1], /^log: /);
});
