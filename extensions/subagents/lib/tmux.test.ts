import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { after, test } from "node:test";
import type { ExecResult } from "@earendil-works/pi-coding-agent";
import { createTmux, type Exec, sessionName } from "./tmux.ts";

function fake(results: Partial<ExecResult>[]) {
  const calls: string[][] = [];
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args]);
    const next = results.shift();
    if (next === undefined) throw new Error(`no fake result for ${args.join(" ")}`);
    return { stdout: "", stderr: "", code: 0, killed: false, ...next };
  };
  return { exec, calls };
}

test("sessionName uses the first 8 characters of the session id", () => {
  assert.equal(sessionName("0199a1b2-c3d4-7e5f"), "pi-sub-0199a1b2");
});

test("sessionName rejects an id that tmux cannot use", () => {
  assert.throws(() => sessionName(""), /not usable/);
  assert.throws(() => sessionName("abc.def:ghi"), /not usable/);
});

test("openWindow creates the session when it is absent", async () => {
  const { exec, calls } = fake([{ code: 1, stderr: "can't find session: pi-sub-x" }, { stdout: "@3\n" }]);
  const id = await createTmux(exec, "sock").openWindow("pi-sub-x", "scout", ["pi", "-p"]);
  assert.equal(id, "@3");
  assert.deepEqual(calls[1], ["tmux", "-L", "sock", "new-session", "-d", "-s", "pi-sub-x", "-P", "-F", "#{window_id}", "-n", "scout", "pi", "-p"]);
});

test("openWindow adds a window to an existing session", async () => {
  const { exec, calls } = fake([{}, { stdout: "@4" }]);
  await createTmux(exec).openWindow("pi-sub-x", "scout", ["pi"]);
  assert.deepEqual(calls[1]?.slice(0, 5), ["tmux", "new-window", "-d", "-t", "=pi-sub-x:"]);
});

test("openWindow passes env as -e arguments before the command", async () => {
  const { exec, calls } = fake([{}, { stdout: "@4" }]);
  await createTmux(exec).openWindow("pi-sub-x", "sub-ab12", ["pi", "-e", "/x.ts"], { A: "1", B: "two words" });
  assert.deepEqual(calls[1], [
    "tmux",
    "new-window",
    "-d",
    "-t",
    "=pi-sub-x:",
    "-P",
    "-F",
    "#{window_id}",
    "-n",
    "sub-ab12",
    "-e",
    "A=1",
    "-e",
    "B=two words",
    "pi",
    "-e",
    "/x.ts",
  ]);
});

test("unsetOption uses -u with an exact session target", async () => {
  const { exec, calls } = fake([{}]);
  await createTmux(exec).unsetOption("pi-sub-x", "@pi-sub-socket");
  assert.deepEqual(calls[0], ["tmux", "set-option", "-u", "-t", "=pi-sub-x:", "@pi-sub-socket"]);
});

test("openWindow rejects a bad window name and an empty command", async () => {
  const tmux = createTmux(fake([]).exec);
  await assert.rejects(tmux.openWindow("s", "a b", ["pi"]), /window name/);
  await assert.rejects(tmux.openWindow("s", "ok", []), /no command/);
});

test("a server without sessions is read as an absent session", async () => {
  const { exec } = fake([{ code: 1, stderr: "no current target" }]);
  assert.equal(await createTmux(exec).hasSession("s"), false);
});

test("a server that exits during the check is read as an absent session", async () => {
  const { exec } = fake([{ code: 1, stderr: "server exited unexpectedly" }]);
  assert.equal(await createTmux(exec).hasSession("s"), false);
});

test("an unknown tmux error is not read as an absent session", async () => {
  const { exec } = fake([{ code: 1, stderr: "permission denied" }]);
  await assert.rejects(createTmux(exec).hasSession("s"), /exit code 1: permission denied/);
});

test("setOption and killSession use an exact session target", async () => {
  const { exec, calls } = fake([{}, {}]);
  const tmux = createTmux(exec);
  await tmux.setOption("pi-sub-x", "@pi-sub-socket", "/run/x.sock");
  await tmux.killSession("pi-sub-x");
  assert.deepEqual(calls[0], ["tmux", "set-option", "-t", "=pi-sub-x:", "@pi-sub-socket", "/run/x.sock"]);
  assert.deepEqual(calls[1], ["tmux", "kill-session", "-t", "=pi-sub-x"]);
});

const socket = `pi-subagents-test-${process.pid}`;
const realExec: Exec = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 127;
      resolve({ stdout, stderr, code, killed: false });
    });
  });

after(async () => {
  await realExec("tmux", ["-L", socket, "kill-server"]);
});

test("real tmux: open two windows and list them", async () => {
  const tmux = createTmux(realExec, socket);
  assert.deepEqual(await tmux.listWindows("pi-sub-test"), []);
  const first = await tmux.openWindow("pi-sub-test", "one", ["sleep", "30"]);
  const second = await tmux.openWindow("pi-sub-test", "two", ["sleep", "30"]);
  assert.deepEqual(await tmux.listWindows("pi-sub-test"), [
    { id: first, name: "one" },
    { id: second, name: "two" },
  ]);
});

test("real tmux: setOption stores the value and killSession removes the session", async () => {
  const tmux = createTmux(realExec, socket);
  await tmux.openWindow("pi-sub-opt", "one", ["sleep", "30"]);
  await tmux.setOption("pi-sub-opt", "@pi-sub-socket", "/run/x.sock");
  const shown = await realExec("tmux", ["-L", socket, "show-options", "-t", "=pi-sub-opt:", "-v", "@pi-sub-socket"]);
  assert.equal(shown.stdout.trim(), "/run/x.sock");
  await tmux.killSession("pi-sub-opt");
  assert.equal(await tmux.hasSession("pi-sub-opt"), false);
});

test("real tmux: env reaches the command and unsetOption removes the option", async () => {
  const tmux = createTmux(realExec, socket);
  const out = `/tmp/pi-sub-env-${process.pid}`;
  await tmux.openWindow("pi-sub-env", "one", ["sh", "-c", `printf %s "$PI_SUBAGENT_ID" > ${out}; sleep 30`], { PI_SUBAGENT_ID: "abc 1" });
  await tmux.setOption("pi-sub-env", "@pi-sub-socket", "/run/x.sock");
  assert.equal(await tmux.getOption("pi-sub-env", "@pi-sub-socket"), "/run/x.sock");
  await tmux.unsetOption("pi-sub-env", "@pi-sub-socket");
  assert.equal(await tmux.getOption("pi-sub-env", "@pi-sub-socket"), undefined);
  for (let i = 0; i < 50 && !existsSync(out); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await readFile(out, "utf8"), "abc 1");
  await rm(out);
});

test("getOption returns undefined for an absent session and for an unset option", async () => {
  const absent = fake([{ code: 1, stderr: "can't find session: s" }]);
  assert.equal(await createTmux(absent.exec).getOption("s", "@pi-sub-socket"), undefined);
  const unset = fake([{}, { stdout: "\n" }]);
  assert.equal(await createTmux(unset.exec).getOption("s", "@pi-sub-socket"), undefined);
});

test("getOption reads the option with an exact session target", async () => {
  const { exec, calls } = fake([{}, { stdout: "/run/x.sock\n" }]);
  assert.equal(await createTmux(exec).getOption("pi-sub-x", "@pi-sub-socket"), "/run/x.sock");
  assert.deepEqual(calls[1], ["tmux", "show-options", "-qv", "-t", "=pi-sub-x:", "@pi-sub-socket"]);
});
