import assert from "node:assert/strict";
import { test } from "node:test";
import { type EnsureOptions, ensureSupervisor } from "./ensure.ts";

function setup(options: { has: boolean[]; option: (string | undefined)[] }) {
  const calls: string[] = [];
  let slept = 0;
  const tmux = {
    hasSession: async () => options.has.shift() as boolean,
    openWindow: async (...args: unknown[]) => {
      calls.push(`open ${JSON.stringify(args)}`);
      return "@0";
    },
    getOption: async () => options.option.shift(),
  };
  const timers = {
    setTimeout: (callback: () => void) => {
      slept++;
      queueMicrotask(callback);
      return 0;
    },
    clearTimeout: () => {},
  };
  const base: EnsureOptions = {
    tmux,
    timers,
    sessionId: "abcd1234-ffff",
    supervisorPath: "/x/supervisor.ts",
    execPath: "/bin/node",
    runtimeRoot: "/tmp",
    pollMs: 50,
    timeoutMs: 200,
  };
  return { base, calls, slept: () => slept };
}

test("ensure returns the socket of a running supervisor and opens nothing", async () => {
  const { base, calls } = setup({ has: [], option: ["/run/s.sock"] });
  assert.deepEqual(await ensureSupervisor(base), { session: "pi-sub-abcd1234", socket: "/run/s.sock" });
  assert.deepEqual(calls, []);
});

test("ensure starts the supervisor in window 0 and polls for the option", async () => {
  const { base, calls, slept } = setup({ has: [false], option: [undefined, undefined, undefined, "/run/s.sock"] });
  assert.deepEqual(await ensureSupervisor(base), { session: "pi-sub-abcd1234", socket: "/run/s.sock" });
  assert.deepEqual(calls, [
    `open ${JSON.stringify(["pi-sub-abcd1234", "supervisor", ["/bin/node", "/x/supervisor.ts", "--session", "pi-sub-abcd1234", "--dir", "/tmp/pi-sub-abcd1234"]])}`,
  ]);
  assert.equal(slept(), 3);
});

test("ensure does not open a second window when the session exists", async () => {
  const { base, calls } = setup({ has: [true], option: [undefined, "/run/s.sock"] });
  await ensureSupervisor(base);
  assert.deepEqual(calls, []);
});

test("ensure fails after the timeout and names the session", async () => {
  const { base, slept } = setup({ has: [false], option: Array(10).fill(undefined) });
  await assert.rejects(ensureSupervisor(base), /"pi-sub-abcd1234".*tmux attach -t pi-sub-abcd1234/);
  assert.equal(slept(), 4);
});
