import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunResult } from "../../../shared/pair.ts";
import {
  diagnosticsExpr,
  errorMessage,
  LspChecks,
  loadExpr,
  parseDiagnostics,
  parseLoad,
  parsePoll,
  pollExpr,
  QUIET_MS,
  releaseExpr,
  socketMessage,
  TIMEOUT_MS,
  timeoutMessage,
  unsavedMessage,
  wipeExpr,
} from "./lsp.ts";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });
const load = (state: { buf: number; modified: boolean; created: boolean }) => ok(JSON.stringify(state));

type Reply = (expr: string) => RunResult;

function setup(reply: Reply, opts: { read?: () => string | undefined; systemctl?: RunResult } = {}) {
  let clock = 0;
  const calls: string[][] = [];
  const exec = async (command: string, args: string[]): Promise<RunResult> => {
    calls.push([command, ...args]);
    if (command === "systemctl") return opts.systemctl ?? ok("");
    return reply(args.at(-1) ?? "");
  };
  const deps = {
    server: "/run/user/1/nvim/main.sock",
    nvim: "nvim",
    exec,
    sleep: async (ms: number) => {
      clock += ms;
    },
    read: opts.read ?? (() => "same"),
    now: () => clock,
  };
  return { deps, calls, clock: () => clock };
}

test("lua expressions use one-line Lua in a Vim string and name the nvim pieces", () => {
  const expression = loadExpr("/w/it's/a.ts");
  assert.match(expression, /^luaeval\('/);
  assert.match(expression, /'\/w\/it''s\/a\.ts'\)$/);
  assert.match(expression, /buflisted = false/);
  assert.match(expression, /vim\.fn\.bufload/);
  assert.match(expression, /DiagnosticChanged/);
  assert.match(pollExpr(7), /vim\.lsp\.get_clients\(\{bufnr = buf\}\)/);
  assert.match(pollExpr(7), /, 7\)$/);
  assert.match(diagnosticsExpr(7), /severity = vim\.diagnostic\.severity\.ERROR/);
  assert.match(diagnosticsExpr(7), /d\.lnum \+ 1/);
  assert.match(wipeExpr(7), /nvim_buf_delete/);
});

test("parses a buffer state, a poll result and the diagnostics", () => {
  assert.deepEqual(parseLoad('{"buf":3,"modified":false,"created":true}'), { buf: 3, modified: false, created: true });
  assert.deepEqual(parsePoll('{"clients":1,"changes":2,"busy":0,"quiet":0}'), { clients: 1, changes: 2, busy: 0, quiet: 0 });
  assert.deepEqual(parseDiagnostics('[{"line":2,"col":5,"source":"vtsls","message":"bad"}]'), [{ line: 2, col: 5, source: "vtsls", message: "bad" }]);
  assert.deepEqual(parseDiagnostics('[{"line":2,"col":5,"message":"bad"}]'), [{ line: 2, col: 5, source: "", message: "bad" }]);
  assert.throws(() => parseLoad("[]"), /no JSON object/);
  assert.throws(() => parsePoll('{"clients":"1"}'), /unexpected poll result/);
  assert.throws(() => parseDiagnostics("{}"), /no JSON list/);
  assert.throws(() => parseDiagnostics('[{"line":"2"}]'), /unexpected diagnostic/);
});

test("the messages name the file, the error lines and the socket", () => {
  assert.equal(
    errorMessage("src/a.ts", [
      { line: 2, col: 5, source: "vtsls", message: "Type 'x' is not assignable" },
      { line: 9, col: 1, source: "", message: "broken" },
    ]),
    "LSP errors after the edit of src/a.ts:\n2:5 vtsls: Type 'x' is not assignable\n9:1 broken",
  );
  assert.equal(errorMessage("a.ts", [{ line: 1, col: 1, source: "nixd", message: "x" }]), "LSP errors after the edit of a.ts:\n1:1 nixd: x");
  assert.match(unsavedMessage("a.ts"), /the user has unsaved changes in a\.ts in nvim, LSP not checked/);
  assert.match(timeoutMessage("a.ts"), /LSP gave no result for a\.ts in 15 s/);
  assert.match(socketMessage("/run/main.sock", "E247"), /\/run\/main\.sock does not answer \(E247\)[\s\S]*journalctl --user -u nvim@main/);
});

test("a file type without an LSP client gives no message and wipes the buffer pi created", async () => {
  const { deps, calls } = setup((expr) =>
    expr.includes("vim.lsp.get_clients") ? ok('{"clients":0,"changes":0,"busy":0,"quiet":0}') : load({ buf: 7, modified: false, created: true }),
  );
  const messages: string[] = [];
  const checks = new LspChecks(deps, (text) => messages.push(text));
  await checks.afterEdit("t", "a.ts", "/w");
  assert.deepEqual(messages, []);
  assert.deepEqual(calls.at(-1)?.slice(-1), [wipeExpr(7)]);
});

test("an unmodified buffer is reloaded, and a user buffer with unsaved changes is not checked", async () => {
  const seen: string[] = [];
  const { deps } = setup((expr) => {
    seen.push(expr);
    return load({ buf: 4, modified: true, created: false });
  });
  const messages: string[] = [];
  const checks = new LspChecks(deps, (text) => messages.push(text));
  await checks.afterEdit("t", "a.ts", "/w");
  assert.deepEqual(messages, [unsavedMessage("a.ts")]);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /edit!/);
});

test("ERROR diagnostics come as one message, and a clean file sends none", async () => {
  const diag = '[{"line":3,"col":2,"source":"vtsls","message":"bad"}]';
  const { deps } = setup((expr) => {
    if (expr.includes("vim.lsp.get_clients")) return ok('{"clients":1,"changes":1,"busy":0,"quiet":0}');
    if (expr.includes("vim.diagnostic.get")) return ok(diag);
    if (expr.includes("nvim_buf_delete")) return ok("ok");
    return load({ buf: 5, modified: false, created: true });
  });
  const messages: string[] = [];
  const checks = new LspChecks(deps, (text) => messages.push(text));
  await checks.afterEdit("t", "a.ts", "/w");
  assert.deepEqual(messages, [errorMessage("a.ts", parseDiagnostics(diag))]);

  const clean = setup((expr) => {
    if (expr.includes("vim.lsp.get_clients")) return ok('{"clients":1,"changes":1,"busy":0,"quiet":0}');
    if (expr.includes("vim.diagnostic.get")) return ok("[]");
    return load({ buf: 5, modified: false, created: false });
  });
  const quiet: string[] = [];
  await new LspChecks(clean.deps, (text) => quiet.push(text)).afterEdit("t", "a.ts", "/w");
  assert.deepEqual(quiet, []);
});

test("a client that sends no diagnostics is clean after QUIET_MS without LSP progress, and busy progress waits until the timeout", async () => {
  const user = setup((expr) => {
    if (expr.includes("vim.lsp.get_clients")) return ok(`{"clients":1,"changes":0,"busy":0,"quiet":${QUIET_MS}}`);
    if (expr.includes("nvim_del_augroup_by_name")) return ok("ok");
    return load({ buf: 5, modified: false, created: false });
  });
  const clean: string[] = [];
  await new LspChecks(user.deps, (text) => clean.push(text)).afterEdit("t", "a.ts", "/w");
  assert.deepEqual(clean, []);
  assert.deepEqual(user.calls.at(-1)?.slice(-1), [releaseExpr(5)]);
  assert.ok(user.clock() < TIMEOUT_MS);

  const busy = setup((expr) => {
    if (expr.includes("vim.lsp.get_clients")) return ok(`{"clients":1,"changes":0,"busy":1,"quiet":${QUIET_MS}}`);
    return load({ buf: 5, modified: false, created: true });
  });
  const late: string[] = [];
  await new LspChecks(busy.deps, (text) => late.push(text)).afterEdit("t", "a.ts", "/w");
  assert.deepEqual(late, [timeoutMessage("a.ts")]);
});

test("a newer edit of the same file replaces a waiting check, and a changed file drops its result", async () => {
  const { deps, calls } = setup((expr) => {
    if (expr.includes("vim.lsp.get_clients")) return ok('{"clients":1,"changes":1,"busy":0,"quiet":0}');
    if (expr.includes("vim.diagnostic.get")) return ok('[{"line":1,"col":1,"source":"s","message":"bad"}]');
    return load({ buf: 5, modified: false, created: false });
  });
  const messages: string[] = [];
  const checks = new LspChecks(deps, (text) => messages.push(text));
  const first = checks.afterEdit("t1", "a.ts", "/w");
  const second = checks.afterEdit("t2", "a.ts", "/w");
  await Promise.all([first, second]);
  const loads = calls.filter((call) => call.at(-1)?.includes("buflisted = false"));
  assert.equal(loads.length, 1);
  assert.equal(messages.length, 1);

  let content = "old";
  const dropped = setup(
    (expr) => {
      if (expr.includes("vim.lsp.get_clients")) return ok('{"clients":1,"changes":1,"busy":0,"quiet":0}');
      if (expr.includes("vim.diagnostic.get")) return ok('[{"line":1,"col":1,"source":"s","message":"bad"}]');
      return load({ buf: 5, modified: false, created: false });
    },
    { read: () => content },
  );
  const quiet: string[] = [];
  const pending = new LspChecks(dropped.deps, (text) => quiet.push(text)).afterEdit("t", "a.ts", "/w");
  content = "new";
  await pending;
  assert.deepEqual(quiet, []);
});

test("the same message is sent once, and the queue waits for the checks", async () => {
  const { deps } = setup((expr) => {
    if (expr.includes("vim.lsp.get_clients")) return ok('{"clients":1,"changes":1,"busy":0,"quiet":0}');
    if (expr.includes("vim.diagnostic.get")) return ok('[{"line":1,"col":1,"source":"s","message":"bad"}]');
    return load({ buf: 5, modified: false, created: false });
  });
  const messages: string[] = [];
  const checks = new LspChecks(deps, (text) => messages.push(text));
  await checks.afterEdit("t", "a.ts", "/w");
  await checks.afterEdit("t", "a.ts", "/w");
  assert.equal(messages.length, 1);
  assert.equal(checks.editsDone(), undefined);
  const running = checks.afterEdit("t", "a.ts", "/w");
  assert.equal(await checks.editsDone(), false);
  await running;
});

test("a socket that never answers starts the service once and sends one loud error", async () => {
  const { deps, calls } = setup(() => fail("E247: no server"));
  const messages: string[] = [];
  const checks = new LspChecks(deps, (text) => messages.push(text));
  await checks.afterEdit("t", "a.ts", "/w");
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\/run\/user\/1\/nvim\/main\.sock does not answer/);
  assert.match(messages[0], /systemctl --user start nvim@main\.service/);
  assert.match(messages[0], /journalctl --user -u nvim@main/);
  assert.equal(calls.filter((call) => call[0] === "systemctl").length, 1);
  await checks.afterEdit("t", "b.ts", "/w");
  assert.equal(calls.filter((call) => call[0] === "systemctl").length, 1);
});

test("a service that comes up is used, and a result that is not JSON is an error, never a clean result", async () => {
  let first = true;
  const { deps, calls } = setup((expr) => {
    if (expr.includes("buflisted = false")) {
      if (first) {
        first = false;
        return fail("not up");
      }
      return load({ buf: 5, modified: true, created: false });
    }
    return ok("1");
  });
  const messages: string[] = [];
  await new LspChecks(deps, (text) => messages.push(text)).afterEdit("t", "a.ts", "/w");
  assert.deepEqual(messages, [unsavedMessage("a.ts")]);
  assert.equal(calls.filter((call) => call[0] === "systemctl").length, 1);

  const broken = setup(() => ok("no json"));
  const seen: string[] = [];
  await new LspChecks(broken.deps, (text) => seen.push(text)).afterEdit("t", "a.ts", "/w");
  assert.match(seen[0], /LSP: nvim gave no JSON|LSP: the check of a\.ts failed/);
});
