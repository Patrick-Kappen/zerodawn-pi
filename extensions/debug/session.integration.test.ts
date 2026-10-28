import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Debugger } from "./lib/session.ts";

const hasNvim = spawnSync("nvim", ["--version"]).status === 0;

test("nvim server: connection and buffer handling (skipped without nvim on PATH)", { skip: !hasNvim && "nvim is not on PATH" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-debug-"));
  const socket = join(dir, "n.sock");
  const server = spawn("nvim", ["--headless", "--clean", "--listen", socket], { stdio: "ignore" });
  try {
    for (let i = 0; i < 50 && spawnSync("nvim", ["--clean", "--headless", "--server", socket, "--remote-expr", "1"]).status !== 0; i++)
      await new Promise((r) => setTimeout(r, 100));
    const dbg = new Debugger({
      run: async (command, args) => {
        const r = spawnSync(command, args, { encoding: "utf8" });
        return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      nvim: "nvim",
      server: socket,
    });
    await dbg.connect();
    const file = join(dir, "a.txt");
    writeFileSync(file, "one\ntwo\n");
    const made = await dbg.call<{ buffers: { buffer: number; listed: boolean; modified: boolean }[] }>({ op: "buffers", files: [file] });
    assert.equal(made.buffers[0].listed, false);
    assert.equal(made.buffers[0].modified, false);
    const wiped = await dbg.call<{ kept: unknown[] }>({ op: "wipe" });
    assert.deepEqual(wiped.kept, []);
    const bufs = spawnSync("nvim", ["--clean", "--headless", "--server", socket, "--remote-expr", "len(getbufinfo({'buflisted':1}))"], { encoding: "utf8" });
    assert.equal(bufs.stdout.trim(), "1");
    // Without nvim-dap the tool must fail loudly, not hang.
    await assert.rejects(dbg.call({ op: "status" }), /nvim-dap/);
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
