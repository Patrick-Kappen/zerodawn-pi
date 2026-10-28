import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { diagnosticsExpr, loadExpr, parseLoad, parsePoll, pollExpr, wipeExpr } from "./lsp.ts";

const exe = process.env.NVIM || "nvim";
const available = (() => {
  try {
    execFileSync(exe, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const execFileP = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a real nvim loads unlisted buffers, reloads unmodified ones, keeps modified ones and wipes pi buffers (skipped without nvim on PATH)", {
  skip: !available && "nvim is not on PATH",
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-lsp-"));
  const socket = join(dir, "nvim.sock");
  const child = spawn(exe, ["--clean", "--headless", "--listen", socket], { stdio: "ignore" });
  after(() => {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !existsSync(socket); i++) await sleep(50);
  assert.equal(existsSync(socket), true, `nvim did not open ${socket}`);

  const remote = async (expr: string): Promise<string> => {
    const result = await execFileP(exe, ["--clean", "--headless", "--server", socket, "--remote-expr", expr], { encoding: "utf8" });
    return result.stdout.trim();
  };
  const luaJson = async (body: string, arg: number | string) => {
    const value = typeof arg === "number" ? String(arg) : `'${arg.replaceAll("'", "''")}'`;
    return JSON.parse(await remote(`luaeval('${body}', ${value})`));
  };

  const file = join(dir, "a.lua");
  writeFileSync(file, "local x = 1\nreturn x\n");
  const created = parseLoad(await remote(loadExpr(file)));
  assert.equal(created.created, true);
  assert.equal(created.modified, false);
  assert.deepEqual(
    await luaJson(
      "(function(buf) return vim.json.encode({listed = vim.bo[buf].buflisted, loaded = vim.fn.bufloaded(buf) == 1, name = vim.api.nvim_buf_get_name(buf)}) end)(_A)",
      created.buf,
    ),
    {
      listed: false,
      loaded: true,
      name: file,
    },
  );
  assert.deepEqual(parsePoll(await remote(pollExpr(created.buf))), { clients: 0, changes: 0 });
  assert.deepEqual(JSON.parse(await remote(diagnosticsExpr(created.buf))), []);

  writeFileSync(file, "local x = 2\nreturn x\n");
  const reloaded = parseLoad(await remote(loadExpr(file)));
  assert.equal(reloaded.created, false);
  assert.deepEqual(await luaJson("(function(buf) return vim.json.encode(vim.api.nvim_buf_get_lines(buf, 0, -1, false)) end)(_A)", reloaded.buf), [
    "local x = 2",
    "return x",
  ]);

  writeFileSync(file, "local x = 3\nreturn x\n");
  await luaJson("(function(buf) vim.bo[buf].modified = true return vim.json.encode(true) end)(_A)", reloaded.buf);
  const modified = parseLoad(await remote(loadExpr(file)));
  assert.equal(modified.modified, true);
  assert.deepEqual(await luaJson("(function(buf) return vim.json.encode(vim.api.nvim_buf_get_lines(buf, 0, -1, false)) end)(_A)", reloaded.buf), [
    "local x = 2",
    "return x",
  ]);

  await remote(wipeExpr(reloaded.buf));
  assert.equal(await luaJson("(function(buf) return vim.json.encode(vim.api.nvim_buf_is_valid(buf)) end)(_A)", reloaded.buf), false);
});
