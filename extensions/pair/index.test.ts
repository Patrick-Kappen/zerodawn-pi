import assert from "node:assert/strict";
import { test } from "node:test";
import type { Run } from "../../shared/pair.ts";
import register, { type Deps, followExpr, ide, parentExpr, publishSession, startExpr } from "./index.ts";

function setup(replies: Record<string, { code?: number; stdout?: string; stderr?: string }>, socketAppears = true) {
  const calls: string[][] = [];
  const spawned: string[][] = [];
  const run: Run = async (command, args) => {
    calls.push([command, ...args]);
    const r = replies[[command, ...args].join(" ")] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  const deps: Deps = {
    run,
    spawnDetached: (c, a) => spawned.push([c, ...a]),
    exists: () => socketAppears,
    sleep: async () => {},
    env: { XDG_RUNTIME_DIR: "/run/u" },
    pid: 7,
  };
  return { calls, spawned, deps };
}
const client = { "tmux display-message -p -t %1 #{client_name}": { stdout: "c1\n" } };

const paired = {
  ...client,
  "tmux show-option -gqv @pair-c1": { stdout: "/s.sock\n" },
  [`nvim --clean --headless --server /s.sock --remote-expr ${parentExpr}`]: { stdout: "42\n" },
};

test("ide moves the paired Neovide to the worktree and focuses its window", async () => {
  const { calls, spawned, deps } = setup({ ...paired, "hyprctl dispatch focuswindow pid:42": { stdout: "ok\n" } });
  assert.match(await ide(deps, "%1", "/w"), /follows \/w/);
  assert.deepEqual(calls.slice(-3), [
    ["nvim", "--clean", "--headless", "--server", "/s.sock", "--remote-expr", followExpr("/w")],
    ["nvim", "--clean", "--headless", "--server", "/s.sock", "--remote-expr", parentExpr],
    ["hyprctl", "dispatch", "focuswindow", "pid:42"],
  ]);
  assert.equal(spawned.length, 0);
});

test("ide fails loud when Hyprland does not focus the window", async () => {
  const { deps } = setup({ ...paired, "hyprctl dispatch focuswindow pid:42": { stdout: "No such window found" } });
  await assert.rejects(ide(deps, "%1", "/w"), /focuswindow pid:42 failed: No such window found/);
});

test("ide starts Neovide and the pair when none exists", async () => {
  const { calls, spawned, deps } = setup(client);
  assert.match(await ide(deps, "%1", "/w"), /started on \/w/);
  assert.deepEqual(spawned, [["neovide", "--", "--listen", "/run/u/pi-ide-7.sock"]]);
  assert.deepEqual(calls.at(-2), ["pair", "register", "c1", "/run/u/pi-ide-7.sock"]);
  assert.deepEqual(calls.at(-1)?.slice(-1), [startExpr("/w")]);
});

test("ide fails loud: no tmux, no socket, nvim error", async () => {
  await assert.rejects(ide(setup({}).deps, undefined, "/w"), /TMUX_PANE/);
  await assert.rejects(ide(setup(client, false).deps, "%1", "/w"), /did not open \/run\/u\/pi-ide-7.sock/);
  const failing = setup({
    ...client,
    "tmux show-option -gqv @pair-c1": { stdout: "/s\n" },
    [`nvim --clean --headless --server /s --remote-expr ${followExpr("/w")}`]: { code: 1, stderr: "no server" },
  });
  await assert.rejects(ide(failing.deps, "%1", "/w"), /following the worktree failed.*no server/);
});

test("expressions escape single quotes", () => {
  assert.match(followExpr("/it's"), /'\/it''s'\)$/);
});

test("publishSession sets the pane option, and does nothing outside tmux", async () => {
  const { calls, deps } = setup({});
  await publishSession(deps.run, "%1", "abc");
  assert.deepEqual(calls, [["tmux", "set-option", "-p", "-t", "%1", "@pair-agent-session", "abc"]]);
  await publishSession(deps.run, undefined, "abc");
  assert.equal(calls.length, 1);
  await assert.rejects(
    publishSession(setup({ "tmux set-option -p -t %1 @pair-agent-session abc": { code: 1, stderr: "x" } }).deps.run, "%1", "abc"),
    /@pair-agent-session failed: x/,
  );
});

test("the extension registers /ide and the session_start handler", () => {
  const seen: string[] = [];
  register({ on: (e: string) => seen.push(`on:${e}`), registerCommand: (n: string) => seen.push(`cmd:${n}`) } as never);
  assert.deepEqual(seen, ["on:session_start", "cmd:ide"]);
});
