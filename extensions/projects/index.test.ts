import assert from "node:assert/strict";
import { test } from "node:test";
import type { Run } from "../../shared/pair.ts";
import register from "./index.ts";
import { loadItems, newWorktree, removeWorktree, slug, switchTo } from "./lib/actions.ts";
import { type Item, initial, mark, parseWorktrees, render, step, typedPath, visible } from "./lib/model.ts";
import { toInput } from "./lib/picker.ts";

const item = (path: string, open = false, agent = false): Item => ({ path, label: path, open, agent, window: open ? "@1" : undefined });
const state = () => initial({ projects: [item("/a/one", true, true), item("/a/two")], worktrees: [item("/a/one", true, true), item("/a/one-x")] });

const fake =
  (replies: Record<string, { code?: number; stdout?: string; stderr?: string }>, calls: string[][] = []): Run =>
  async (command, args) => {
    const key = [command, ...args].join(" ");
    calls.push([command, ...args]);
    const r = replies[key] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };

test("tab switches the scope and resets the cursor", () => {
  const s = step(step(state(), { kind: "down" }).state, { kind: "tab" }).state;
  assert.equal(s.scope, "worktrees");
  assert.equal(s.cursor, 0);
  assert.equal(step(s, { kind: "tab" }).state.scope, "projects");
});

test("typing filters, enter selects the cursor item, escape cancels", () => {
  const s = step(state(), { kind: "text", text: "two" }).state;
  assert.deepEqual(
    visible(s).map((i) => i.path),
    ["/a/two"],
  );
  assert.deepEqual(step(s, { kind: "enter" }).outcome, { kind: "select", path: "/a/two" });
  assert.deepEqual(step(s, { kind: "escape" }).outcome, { kind: "cancel" });
  assert.equal(step(s, { kind: "backspace" }).state.query, "tw");
});

test("a typed path is accepted without a match", () => {
  const s = step(state(), { kind: "text", text: "/srv/new" }).state;
  assert.deepEqual(step(s, { kind: "enter" }).outcome, { kind: "select", path: "/srv/new" });
  assert.equal(typedPath("~/x", "/h"), "/h/x");
  assert.equal(typedPath("plain"), undefined);
});

test("ctrl-n asks for a new worktree, ctrl-d removes only in the worktrees scope", () => {
  assert.deepEqual(step(state(), { kind: "ctrl-n" }).outcome, { kind: "new" });
  assert.equal(step(state(), { kind: "ctrl-d" }).outcome, undefined);
  const w = step(state(), { kind: "tab" }).state;
  assert.deepEqual(step(w, { kind: "ctrl-d" }).outcome, { kind: "remove", item: w.items.worktrees[0] });
});

test("render marks open and pi-running entries", () => {
  assert.equal(mark(item("/x", true, true)), "●π");
  assert.equal(mark(item("/x")), "○ ");
  const lines = render(state());
  assert.match(lines[0], /\[projects\].*worktrees/);
  assert.match(lines[1], /^› ●π /);
  assert.match(lines[2], /○ /);
});

test("toInput maps keys", () => {
  assert.deepEqual(toInput("\t"), { kind: "tab" });
  assert.deepEqual(toInput("\r"), { kind: "enter" });
  assert.deepEqual(toInput("\x0e"), { kind: "ctrl-n" });
  assert.deepEqual(toInput("\x04"), { kind: "ctrl-d" });
  assert.deepEqual(toInput("a"), { kind: "text", text: "a" });
});

test("loadItems lists open entries, and zoxide when none is open", async () => {
  const open = "/r/.git\t/r\t@1\t1\n";
  const wt = "worktree /r\nHEAD x\n\nworktree /r-x\nHEAD y\n";
  const a = await loadItems(fake({ "pair list": { stdout: open }, "git worktree list --porcelain": { stdout: wt } }), {});
  assert.deepEqual(
    a.projects.map((i) => [i.path, i.agent]),
    [["/r", true]],
  );
  assert.deepEqual(
    a.worktrees.map((i) => [i.path, i.open]),
    [
      ["/r", true],
      ["/r-x", false],
    ],
  );
  const b = await loadItems(fake({ "zoxide query -l": { stdout: "/p/one\n/p/two\n" } }), {});
  assert.deepEqual(
    b.projects.map((i) => i.path),
    ["/p/one", "/p/two"],
  );
  assert.equal(parseWorktrees(wt).length, 2);
});

test("switchTo goes through the pair script and fails loud without a pair", async () => {
  const calls: string[][] = [];
  const run = fake({ "tmux display-message -p -t %1 #{client_name}": { stdout: "c1\n" }, "tmux show-option -gqv @pair-c1": { stdout: "/s.sock\n" } }, calls);
  await switchTo(run, "%1", "/w", {});
  assert.deepEqual(calls.at(-1), ["pair", "open", "/s.sock", "/w"]);
  await assert.rejects(switchTo(run, undefined, "/w", {}), /TMUX_PANE/);
  await assert.rejects(switchTo(fake({ "tmux display-message -p -t %1 #{client_name}": { stdout: "c1\n" } }), "%1", "/w", {}), /Run \/ide/);
});

test("newWorktree adds a branch next to the main worktree", async () => {
  const calls: string[][] = [];
  const run = fake({ "git rev-parse --path-format=absolute --git-common-dir": { stdout: "/home/me/repo/.git\n" } }, calls);
  assert.equal(await newWorktree(run, "my feat"), "/home/me/repo-my-feat");
  assert.deepEqual(calls.at(-1), ["git", "worktree", "add", "-b", "my-feat", "/home/me/repo-my-feat"]);
  assert.equal(slug(" a/b "), "a-b");
  await assert.rejects(newWorktree(run, "  "), /branch name is empty/);
});

test("removeWorktree removes the worktree and its window, and names a failure", async () => {
  const calls: string[][] = [];
  await removeWorktree(fake({}, calls), item("/r-x", true));
  assert.deepEqual(calls, [
    ["git", "worktree", "remove", "/r-x"],
    ["tmux", "kill-window", "-t", "@1"],
  ]);
  await assert.rejects(removeWorktree(fake({ "git worktree remove /r-x": { code: 1, stderr: "dirty" } }), item("/r-x")), /\/r-x failed: dirty/);
});

test("the extension registers /switch and alt+p", () => {
  const seen: string[] = [];
  register({ registerCommand: (n: string) => seen.push(`cmd:${n}`), registerShortcut: (k: string) => seen.push(`key:${k}`) } as never);
  assert.deepEqual(seen, ["cmd:switch", "key:alt+p"]);
});
