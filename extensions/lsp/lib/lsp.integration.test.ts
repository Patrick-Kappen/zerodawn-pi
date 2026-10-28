import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Deps, expression, Lsp, type RunResult } from "./run.ts";

const nvim = "nvim";
const dir = mkdtempSync(join(tmpdir(), "lsp-integration-"));
const socket = join(dir, "nvim.sock");
const child = spawn(nvim, ["--clean", "--headless", "--listen", socket], { stdio: ["ignore", "ignore", "pipe"] });
let serverError = "";
child.stderr.on("data", (data) => {
  serverError += String(data);
});

after(async () => {
  if (child.exitCode === null) {
    child.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  rmSync(dir, { recursive: true, force: true });
});

const run = (command: string, args: string[]): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: 20_000 }, (error: any, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr });
    });
  });

const remote = async (expr: string): Promise<string> => {
  const result = await run(nvim, ["--clean", "--headless", "--server", socket, "--remote-expr", expr]);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A fake LSP: a client that counts as attached, and a diagnostic on BufRead, from a test namespace. No LSP server.
const SETUP = `
(function()
  vim.lsp.get_clients = function() return { { id = 1, name = "fake" } } end
  vim.api.nvim_create_autocmd("BufRead", {
    callback = function(args)
      local ns = vim.api.nvim_create_namespace("pi-lsp-test")
      vim.diagnostic.set(ns, args.buf, {
        { lnum = 1, col = 2, severity = vim.diagnostic.severity.ERROR, source = "fake", message = "first error" },
      })
    end,
  })
  return vim.json.encode({ ok = true })
end)()`;

test("a created buffer gets diagnostics from an autocmd and is wiped afterwards", { timeout: 30_000 }, async () => {
  for (let i = 0; i < 100 && !existsSync(socket); i++) await sleep(50);
  assert.equal(existsSync(socket), true, `nvim did not listen on ${socket}: ${serverError}`);
  assert.deepEqual(JSON.parse(await remote(expression(SETUP, 0))), { ok: true });

  const file = join(dir, "a.ts");
  writeFileSync(file, "const a = 1\n");
  const messages: string[] = [];
  const deps: Deps = {
    nvim,
    env: { PI_NVIM_SERVER: socket },
    run,
    exists: existsSync,
    sleep: async (ms: number) => {
      await sleep(ms);
    },
    now: () => Date.now(),
    read: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
  };
  const lsp = new Lsp(deps, (text) => messages.push(text));
  await lsp.afterEdit(file, dir);

  assert.deepEqual(messages, [`LSP errors after the edit of ${file}:\n${file}:2:3 fake: first error`]);

  const listed = `(function(path)
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_get_name(b) == path then return vim.json.encode(true) end
    end
    return vim.json.encode(false)
  end)(_A)`;
  assert.equal(JSON.parse(await remote(expression(listed, file))), false, "pi wiped the buffer that it created");
});
