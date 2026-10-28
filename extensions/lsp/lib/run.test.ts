import assert from "node:assert/strict";
import { test } from "node:test";
import { conflict, noResult } from "./format.ts";
import { type Deps, findBufferExpr, Lsp, pollBufferExpr, readDiagnosticsExpr, wipeBufferExpr } from "./run.ts";

const dir = "/w";
const file = "/w/a.ts";

type Options = {
  buffer?: Record<string, unknown>;
  polls?: { clients: number; counter: number }[];
  diagnostics?: { lnum: number; col: number; source?: string | null; message: string }[];
  read?: () => string | undefined;
  exists?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
  failPoll?: boolean;
};

const json = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

function setup(options: Options = {}) {
  const calls: { command: string; args: string[] }[] = [];
  const buf = typeof options.buffer?.buf === "number" ? options.buffer.buf : 1;
  let clock = 0;
  let poll = 0;
  const reads = options.read ?? (() => "same");
  const deps: Deps = {
    nvim: "nvim",
    env: options.env ?? { PI_NVIM_SERVER: "/s.sock" },
    exists: options.exists ?? ((path) => path === "/s.sock"),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    read: reads,
    run: async (command, args) => {
      calls.push({ command, args });
      if (command === "systemctl") return { code: 0, stdout: "", stderr: "" };
      const expr = args.at(-1);
      if (expr === findBufferExpr(file)) return json(options.buffer ?? { buf, created: false, modified: false, clients: 1 });
      if (expr === pollBufferExpr(buf)) {
        if (options.failPoll) return { code: 1, stdout: "", stderr: "server gone" };
        const samples = options.polls ?? [{ clients: 1, counter: 1 }];
        return json(samples[Math.min(poll++, samples.length - 1)]);
      }
      if (expr === readDiagnosticsExpr(buf)) return json({ diagnostics: options.diagnostics ?? [] });
      if (expr === wipeBufferExpr(buf)) return json({ ok: true });
      return { code: 1, stdout: "", stderr: `unexpected ${expr}` };
    },
  };
  const messages: string[] = [];
  const lsp = new Lsp(deps, (text) => messages.push(text));
  return { calls, lsp, messages, wiped: () => calls.some((c) => c.args.at(-1) === wipeBufferExpr(buf)) };
}

test("unsaved changes in nvim skip the check and the reload", async () => {
  const { calls, lsp, messages } = setup({ buffer: { buf: 2, created: false, modified: true, clients: 0 } });
  await lsp.afterEdit("a.ts", dir);
  assert.deepEqual(messages, [conflict(file)]);
  assert.equal(calls.filter((c) => c.command === "nvim").length, 1);
});

test("no attached client within 3 s is not an error", async () => {
  const { lsp, messages } = setup({ polls: [{ clients: 0, counter: 0 }] });
  await lsp.afterEdit("a.ts", dir);
  assert.deepEqual(messages, []);
});

test("errors become one message; a clean run gives none; the same message comes once", async () => {
  const diagnostics = [{ lnum: 3, col: 5, source: "ts", message: "Cannot find name 'x'." }];
  const { lsp, messages, wiped } = setup({ buffer: { buf: 1, created: true, modified: false, clients: 1 }, diagnostics });
  await lsp.afterEdit("a.ts", dir);
  assert.deepEqual(messages, ["LSP errors after the edit of /w/a.ts:\n/w/a.ts:3:5 ts: Cannot find name 'x'."]);
  assert.equal(wiped(), true, "the buffer that pi created is wiped");
  await lsp.afterEdit("a.ts", dir);
  assert.equal(messages.length, 1, "the same message comes once");

  const clean = setup({ buffer: { buf: 1, created: false, modified: false, clients: 1 }, diagnostics: [] });
  await clean.lsp.afterEdit("a.ts", dir);
  assert.deepEqual(clean.messages, []);
});

test("an attached client without a result in 15 s is an error; a created buffer is wiped", async () => {
  const { lsp, messages, wiped } = setup({ buffer: { buf: 1, created: true, modified: false, clients: 1 }, polls: [{ clients: 1, counter: 0 }] });
  await lsp.afterEdit("a.ts", dir);
  assert.deepEqual(messages, [noResult(file)]);
  assert.equal(wiped(), true);
});

test("a failed poll is a clear error and still wipes a created buffer", async () => {
  const { lsp, messages, wiped } = setup({ buffer: { buf: 1, created: true, modified: false, clients: 1 }, failPoll: true });
  await lsp.afterEdit("a.ts", dir);
  assert.match(messages[0], /^lsp: polling the diagnostics failed on the nvim server \/s\.sock: server gone$/);
  assert.equal(wiped(), true);
});

test("a file that changed during the run gives no message", async () => {
  let reads = 0;
  const diagnostics = [{ lnum: 1, col: 1, source: "ts", message: "old" }];
  const { lsp, messages } = setup({
    buffer: { buf: 1, created: true, modified: false, clients: 1 },
    diagnostics,
    read: () => (reads++ === 0 ? "before" : "after"),
  });
  await lsp.afterEdit("a.ts", dir);
  assert.deepEqual(messages, []);
});

test("a missing socket starts nvim@main.service once, waits 5 s, then reports a clear error", async () => {
  const { calls, lsp, messages } = setup({ env: { PI_NVIM_SERVER: "/missing.sock" }, exists: () => false });
  await lsp.afterEdit("a.ts", dir);
  await lsp.afterEdit("a.ts", dir);
  assert.equal(calls.filter((c) => c.command === "systemctl").length, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^lsp: nvim server \/missing\.sock is missing and did not appear within 5 s/);
});

test("a socket that appears while waiting continues the check", async () => {
  let checks = 0;
  const { calls, lsp, messages } = setup({
    env: { PI_NVIM_SERVER: "/late.sock" },
    exists: () => ++checks > 3,
    buffer: { buf: 1, created: false, modified: true, clients: 0 },
  });
  await lsp.afterEdit("a.ts", dir);
  assert.equal(
    calls.some((c) => c.command === "systemctl"),
    true,
  );
  assert.deepEqual(messages, [conflict(file)]);
});

test("without PI_NVIM_SERVER the check fails loud", async () => {
  const { lsp, messages } = setup({ env: {} });
  await lsp.afterEdit("a.ts", dir);
  assert.match(messages[0], /^lsp: PI_NVIM_SERVER is not set; LSP checks are off\.$/);
});
