import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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

test("openWindow rejects a bad window name and an empty command", async () => {
  const tmux = createTmux(fake([]).exec);
  await assert.rejects(tmux.openWindow("s", "a b", ["pi"]), /window name/);
  await assert.rejects(tmux.openWindow("s", "ok", []), /no command/);
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
