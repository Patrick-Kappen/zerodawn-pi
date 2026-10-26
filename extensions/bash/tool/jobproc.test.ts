import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { digest, errorLines, exitStatus, render, resultText, spawnJob, summarizeFromDisk, tailLimit } from "./jobproc.ts";

function run(command: string, limit = 10): Promise<{ code: number | null; sig: string | null; dir: string; log: string; status: string }> {
  const dir = mkdtempSync(join(tmpdir(), "bash-"));
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

test("a job runs without a terminal, keeps the output and reports its exit code", async () => {
  const r = await run('tty -s || echo no-tty; printf "\\e[32mok\\e[0m\\n"; printf "a\\rb\\n"; exit 3');
  assert.equal(r.code, 3);
  assert.equal(readFileSync(r.status, "utf8").trim(), "3");
  const out = render(r.log, 1 << 20);
  assert.deepEqual(out.plain, ["no-tty", "ok", "b"]);
  assert.match(out.lines[1], /\x1b\[32mok\x1b\[0m/);
  assert.equal(resultText(r.log, "exit 3 (1s)"), "exit 3 (1s)\nno-tty\nok\nb");
});

test("a prompt gets EOF at once and an editor fails instead of waiting", async () => {
  const r = await run('read -r a </dev/stdin; echo "read=$?"; $GIT_EDITOR x || echo editor-failed; printf "x\\n" | $PAGER', 5);
  assert.deepEqual(render(r.log, 1 << 20).plain, ["read=1", "editor-failed", "x"]);
});

test("a pipe that closes early ends the writer with SIGPIPE, not with an error", async () => {
  const r = await run('yes | head -1; echo "${PIPESTATUS[0]}"', 5);
  assert.deepEqual(render(r.log, 1 << 20).plain, ["y", "141"]);
});

test("the time limit kills the whole job", async () => {
  const r = await run("echo start; sleep 20; echo never", 1);
  assert.equal(r.sig, "SIGTERM");
  assert.equal(readFileSync(r.status, "utf8").trim(), "timeout");
  assert.match(exitStatus(r.status, 1) ?? "", /^killed at the time limit of 1s/);
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(render(r.log, 1 << 20).plain, ["start"]);
});

test("summarizeFromDisk reads the exit code from the script footer of an old log when the status file is gone", () => {
  const dir = mkdtempSync(join(tmpdir(), "bash-"));
  const log = join(dir, "job.log");
  writeFileSync(log, 'Script started on x\nhi\r\n\nScript done on y [COMMAND_EXIT_CODE="5"]\n');
  const meta = { id: "x", command: "echo hi", log, status: join(dir, "missing"), start: Date.now(), limit: 0, bg: true, reported: false };
  assert.equal(summarizeFromDisk(meta), "exit 5\nhi");
});

test("tailLimit keeps the last lines inside both limits", () => {
  const lines = ["a", "bb", "ccc", "dddd"];
  assert.deepEqual(tailLimit(lines, 10, 1000), { kept: lines, truncated: false });
  assert.deepEqual(tailLimit(lines, 2, 1000), { kept: ["ccc", "dddd"], truncated: true });
  assert.deepEqual(tailLimit(lines, 10, 9), { kept: ["ccc", "dddd"], truncated: true });
  assert.deepEqual(tailLimit([], 10, 10), { kept: [], truncated: false });
});

test("long output returns head, error lines, tail and the path of the clean output", async () => {
  const r = await run("seq 1 3000 | sed 's/$/ line of forty bytes of padding text ......../; 1500s/.*/error: thing 1500 broke/; 2000s/.*/FAIL case 2000/'");
  const text = resultText(r.log, "exit 0 (1s)");
  const lines = text.split("\n");
  assert.match(lines[0], /^exit 0 \(1s\) · 3000 lines, \d+ bytes · output: .*\.txt$/);
  assert.equal(lines[1], "first 20 lines:");
  assert.match(lines[2], /^1 line of forty/);
  assert.match(lines[21], /^20 line of forty/);
  assert.match(lines[22], /^… \d+ lines not shown · 2 of them look like errors \(line: text\):$/);
  assert.equal(lines[23], "  1500: error: thing 1500 broke");
  assert.equal(lines[24], "  2000: FAIL case 2000");
  assert.match(lines[25], /^last \d+ lines:$/);
  assert.match(lines[lines.length - 1], /^3000 line of forty/);
  const txt = r.log.replace(/\.log$/, ".txt");
  assert.equal(readFileSync(txt, "utf8").split("\n")[1499], "error: thing 1500 broke");
});

test("digest keeps everything when it fits", () => {
  assert.deepEqual(digest(["a", "b"]), { head: [], errors: [], tail: ["a", "b"], hidden: 0, truncated: false });
});

test("errorLines reports each distinct error once with its line number", () => {
  const lines = ["ok", "error: x", "fine", "error: x", "panic: y", "Error 123"];
  assert.deepEqual(errorLines(lines, 0, lines.length, 10, 1000), [
    { n: 2, text: "error: x" },
    { n: 5, text: "panic: y" },
    { n: 6, text: "Error 123" },
  ]);
});
