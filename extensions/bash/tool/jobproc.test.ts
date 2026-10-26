import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { errorLines, exitStatus, render, resultText, spawnJob, summarizeFromDisk } from "./jobproc.ts";

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
  assert.match(
    resultText(r.log, "exit 3 (1s)"),
    /^exit 3 \(1s\) · 3 lines, \d+ bytes · output: .*\.txt\nno line looks like an error; last 3 lines:\nno-tty\nok\nb$/,
  );
});

test("a prompt gets EOF at once and an editor fails instead of waiting", async () => {
  const r = await run('read -r a </dev/stdin; echo "read=$?"; $GIT_EDITOR x || echo editor-failed; printf "x\\n" | $PAGER', 5);
  assert.deepEqual(render(r.log, 1 << 20).plain, ["read=1", "editor-failed", "x"]);
});

test("a pipe that closes early ends the writer with SIGPIPE, not with an error", async () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash variable, not a template placeholder
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
  assert.match(summarizeFromDisk(meta), /^exit 5 · 1 lines, \d+ bytes · output: .*\.txt\nno line looks like an error; last 1 lines:\nhi$/);
});

test("a failure returns the status, the path and only the lines that look like errors", async () => {
  const r = await run("seq 1 3000 | sed 's/$/ line of padding/; 1500s/.*/error: thing 1500 broke/; 2000s/.*/FAIL case 2000/'; exit 1");
  const lines = resultText(r.log, "exit 1 (1s)").split("\n");
  assert.match(lines[0], /^exit 1 \(1s\) \u00b7 3000 lines, \d+ bytes \u00b7 output: .*\.txt$/);
  assert.deepEqual(lines.slice(1), ["2 distinct lines look like errors (lines: text):", "  1500: error: thing 1500 broke", "  2000: FAIL case 2000"]);
  const txt = r.log.replace(/\.log$/, ".txt");
  assert.equal(readFileSync(txt, "utf8").split("\n")[1499], "error: thing 1500 broke");
});

test("a failure without error lines returns the last lines", async () => {
  const r = await run("seq 1 10; exit 2");
  const lines = resultText(r.log, "exit 2 (1s)").split("\n");
  assert.match(lines[0], /^exit 2 \(1s\) \u00b7 10 lines/);
  assert.deepEqual(lines.slice(1), ["no line looks like an error; last 3 lines:", "8", "9", "10"]);
});

test("a success returns short output inline, else only the status and the path", async () => {
  const short = await run("seq 1 50");
  assert.equal(resultText(short.log, "exit 0 (1s)"), `exit 0 (1s)\n${Array.from({ length: 50 }, (_, i) => i + 1).join("\n")}`);
  const r = await run("seq 1 51");
  assert.match(resultText(r.log, "exit 0 (1s)"), /^exit 0 \(1s\) \u00b7 51 lines, \d+ bytes \u00b7 output: .*\.txt$/);
  const silent = await run("true");
  assert.equal(resultText(silent.log, "exit 0 (1s)"), "exit 0 (1s)");
});

test("errorLines reports each distinct error once with all its line numbers", () => {
  const lines = ["ok", "error: x", "fine", "error: x", "panic: y", "Error 123"];
  assert.deepEqual(errorLines(lines), [
    { n: [2, 4], text: "error: x" },
    { n: [5], text: "panic: y" },
    { n: [6], text: "Error 123" },
  ]);
});
