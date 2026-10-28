import assert from "node:assert/strict";
import { test } from "node:test";
import { pairCommand, pairList, pairOpen, pairServer, parseList, type Run } from "./pair.ts";

const fake =
  (replies: Record<string, { code?: number; stdout?: string; stderr?: string }>, calls: string[][] = []): Run =>
  async (command, args) => {
    calls.push([command, ...args]);
    const r = replies[args.join(" ")] ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };

test("parseList reads the four columns and marks the agent", () => {
  assert.deepEqual(parseList("/r/.git\t/r\t@1\t1\n/r/.git\t/r-x\t@2\t0\n"), [
    { repo: "/r/.git", worktree: "/r", window: "@1", agent: true },
    { repo: "/r/.git", worktree: "/r-x", window: "@2", agent: false },
  ]);
  assert.deepEqual(parseList(""), []);
});

test("parseList names the line of a wrong format", () => {
  assert.throws(() => parseList("a\tb"), /expected REPO.*got "a\tb"/);
});

test("pairCommand reads the environment", () => {
  assert.deepEqual(pairCommand({}), { command: "pair", prefix: [] });
  assert.deepEqual(pairCommand({ PI_PAIR_COMMAND: "/x/pair", PI_PAIR_TMUX: "tmuxw" }), { command: "/x/pair", prefix: ["--tmux", "tmuxw"] });
});

test("pairList runs the script with the tmux prefix and fails loud", async () => {
  const calls: string[][] = [];
  const list = await pairList(fake({ "--tmux tw list": { stdout: "/r/.git\t/r\t@1\t0\n" } }, calls), { PI_PAIR_TMUX: "tw" });
  assert.equal(list.length, 1);
  assert.deepEqual(calls[0], ["pair", "--tmux", "tw", "list"]);
  await assert.rejects(pairList(fake({ list: { code: 1, stderr: "boom" } }), {}), /pair list failed \(exit 1\): boom/);
});

test("pairServer finds the paired nvim server of the client", async () => {
  const run = fake({
    "display-message -p -t %3 #{client_name}": { stdout: "/dev/pts/4\n" },
    "show-option -gqv @pair-/dev/pts/4": { stdout: "/tmp/nvim.sock\n" },
  });
  assert.deepEqual(await pairServer(run, "%3"), { client: "/dev/pts/4", server: "/tmp/nvim.sock" });
  assert.equal((await pairServer(fake({ "display-message -p -t %3 #{client_name}": { stdout: "c\n" } }), "%3")).server, undefined);
  await assert.rejects(pairServer(fake({}), "%3"), /no tmux client is attached to pane %3/);
});

test("pairOpen explains exit 3 and other failures", async () => {
  await pairOpen(fake({}), "s", "/d", {});
  await assert.rejects(pairOpen(fake({ "open s /d": { code: 3 } }), "s", "/d", {}), /no tmux client is paired.*\/ide/);
  await assert.rejects(pairOpen(fake({ "open s /d": { code: 4, stderr: "other pair" } }), "s", "/d", {}), /exit 4\): other pair/);
});
