import assert from "node:assert/strict";
import { test } from "node:test";
import { type EnsureOptions, ensureSupervisor } from "./ensure.ts";

function setup(options: { has?: boolean[]; option: (string | undefined)[]; alive?: boolean; windows?: string[] }) {
  const calls: string[] = [];
  let slept = 0;
  const has = options.has ?? [];
  const tmux = {
    hasSession: async () => has.shift() as boolean,
    openWindow: async (...args: unknown[]) => {
      calls.push(`open ${JSON.stringify(args)}`);
      return "@0";
    },
    listWindows: async () => (options.windows ?? []).map((name, i) => ({ id: `@${i}`, name })),
    unsetOption: async (...args: unknown[]) => void calls.push(`unset ${JSON.stringify(args)}`),
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
    probe: async () => options.alive ?? true,
    timers,
    sessionId: "abcd1234-ffff",
    supervisorPath: "/x/supervisor.ts",
    execPath: "/bin/node",
    piCommand: "pi",
    extensionPath: "/x/index.ts",
    runtimeRoot: "/tmp",
    pollMs: 50,
    timeoutMs: 200,
  };
  return { base, calls, slept: () => slept };
}

const SUPERVISOR_COMMAND = [
  "env",
  "BUN_BE_BUN=1",
  "/bin/node",
  "/x/supervisor.ts",
  "--session",
  "pi-sub-abcd1234",
  "--dir",
  "/tmp/pi-sub-abcd1234",
  "--pi",
  "pi",
  "--extension",
  "/x/index.ts",
];

test("ensure returns the socket of a running supervisor and opens nothing", async () => {
  const { base, calls } = setup({ option: ["/run/s.sock"] });
  assert.deepEqual(await ensureSupervisor(base), { session: "pi-sub-abcd1234", socket: "/run/s.sock" });
  assert.deepEqual(calls, []);
});

test("ensure starts the supervisor with pi and the extension and polls for the option", async () => {
  const { base, calls, slept } = setup({ has: [false], option: [undefined, undefined, undefined, "/run/s.sock"] });
  assert.deepEqual(await ensureSupervisor(base), { session: "pi-sub-abcd1234", socket: "/run/s.sock" });
  assert.deepEqual(calls, [`open ${JSON.stringify(["pi-sub-abcd1234", "supervisor", SUPERVISOR_COMMAND])}`]);
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

test("stale socket without a supervisor window: unset the option and start a new supervisor", async () => {
  const { base, calls } = setup({ alive: false, windows: ["sub-ab12"], option: ["/run/old.sock", "/run/new.sock"] });
  assert.deepEqual(await ensureSupervisor(base), { session: "pi-sub-abcd1234", socket: "/run/new.sock" });
  assert.deepEqual(calls, [
    `unset ${JSON.stringify(["pi-sub-abcd1234", "@pi-sub-socket"])}`,
    `open ${JSON.stringify(["pi-sub-abcd1234", "supervisor", SUPERVISOR_COMMAND])}`,
  ]);
});

test("socket that does not answer while the supervisor window exists fails with a clear message", async () => {
  const { base, calls } = setup({ alive: false, windows: ["supervisor"], option: ["/run/old.sock"] });
  await assert.rejects(ensureSupervisor(base), /"\/run\/old.sock", which does not answer, but the window "supervisor" exists.*tmux attach -t pi-sub-abcd1234/);
  assert.deepEqual(calls, []);
});
