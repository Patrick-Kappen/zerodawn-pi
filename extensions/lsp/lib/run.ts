import { absolutePath } from "../../../shared/util.ts";
import { conflict, type Diagnostic, formatDiagnostics, noEnv, noResult, noServer } from "./format.ts";
import { POLL_MS, pollDecision } from "./poll.ts";
import { EditQueue } from "./queue.ts";

export type RunResult = { code: number; stdout: string; stderr: string };
export type Run = (command: string, args: string[]) => Promise<RunResult>;

/** Everything the checks use from outside, so a unit test can replace nvim, the clock and the file. */
export type Deps = {
  nvim: string;
  env: NodeJS.ProcessEnv;
  run: Run;
  exists: (path: string) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  read: (path: string) => string | undefined;
};

export type Notify = (text: string) => void;

type BufferReply = { buf?: unknown; created?: unknown; modified?: unknown };
type PollReply = { clients?: unknown; counter?: unknown };
type DiagnoseReply = { diagnostics?: unknown };

const FIND_BUFFER = `
(function(path)
  local function findbuf()
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      local name = vim.api.nvim_buf_get_name(b)
      if name == path or vim.fn.fnamemodify(name, ":p") == path then
        return b
      end
    end
  end
  local buf = findbuf()
  local created = false
  if buf ~= nil and vim.bo[buf].modified then
    return vim.json.encode({ buf = buf, created = false, modified = true, clients = 0 })
  end
  if buf == nil then
    buf = vim.fn.bufadd(path)
    vim.bo[buf].buflisted = false
    vim.fn.bufload(buf)
    created = true
  end
  -- Before the reload or BufRead: an LSP that answers at once must count too.
  local group = vim.api.nvim_create_augroup("PiLspDiag" .. buf, { clear = true })
  vim.b[buf].pi_lsp_diag = 0
  vim.api.nvim_create_autocmd("DiagnosticChanged", {
    group = group,
    buffer = buf,
    callback = function()
      vim.b[buf].pi_lsp_diag = (vim.b[buf].pi_lsp_diag or 0) + 1
    end,
  })
  vim.api.nvim_buf_call(buf, function()
    if created then vim.cmd("silent filetype detect") else vim.cmd("silent edit!") end
    vim.cmd("silent filetype detect")
    vim.cmd("silent doautocmd BufRead")
  end)
  local function count()
    if vim.lsp.get_clients then
      return #vim.lsp.get_clients({ bufnr = buf })
    end
    return #vim.lsp.buf_get_clients(buf)
  end
  local n = 0
  vim.wait(200, function()
    n = count()
    return n > 0
  end)
  return vim.json.encode({ buf = buf, created = created, modified = false, clients = n })
end)(_A)
`;

const POLL_BUFFER = `
(function(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return vim.json.encode({ buf = buf, clients = 0, counter = 0, valid = false })
  end
  local function count()
    if vim.lsp.get_clients then
      return #vim.lsp.get_clients({ bufnr = buf })
    end
    return #vim.lsp.buf_get_clients(buf)
  end
  return vim.json.encode({ buf = buf, clients = count(), counter = vim.b[buf].pi_lsp_diag or 0, valid = true })
end)(_A)
`;

const READ_DIAGNOSTICS = `
(function(buf)
  local out = {}
  for _, d in ipairs(vim.diagnostic.get(buf, { severity = vim.diagnostic.severity.ERROR })) do
    out[#out + 1] = { lnum = d.lnum + 1, col = d.col + 1, source = d.source, message = d.message }
  end
  return vim.json.encode({ diagnostics = out })
end)(_A)
`;

const WIPE_BUFFER = `
(function(buf)
  if vim.api.nvim_buf_is_valid(buf) then
    pcall(vim.cmd, "silent! bwipeout! " .. buf)
  end
  return vim.json.encode({ ok = true })
end)(_A)
`;

/** A Vimscript single-quoted string: the only escape is a doubled quote. */
const vimString = (text: string): string => `'${text.replaceAll("'", "''")}'`;

const luaArg = (value: string | number) => (typeof value === "number" ? String(value) : `json_decode(${vimString(JSON.stringify(value))})`);

/** The expression for `nvim --remote-expr`: Lua through luaeval, with the argument as `_A`. */
export function expression(code: string, arg: string | number): string {
  return `luaeval(${vimString(code)}, ${luaArg(arg)})`;
}

export const findBufferExpr = (file: string) => expression(FIND_BUFFER, file);
export const pollBufferExpr = (buf: number) => expression(POLL_BUFFER, buf);
export const readDiagnosticsExpr = (buf: number) => expression(READ_DIAGNOSTICS, buf);
export const wipeBufferExpr = (buf: number) => expression(WIPE_BUFFER, buf);

const text = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The checks after an edit. They talk to the user's running nvim server, one run after the other;
 * a newer edit of the same file replaces a pending run. Only errors go to notify, and the same message once.
 */
export class Lsp {
  private queue = new EditQueue();
  private sent = new Set<string>();
  private starting: Promise<void> | undefined;
  private pending = 0;
  private session = new AbortController();

  constructor(
    private readonly deps: Deps,
    private readonly notify: Notify,
  ) {}

  reset(): void {
    this.session.abort();
    this.session = new AbortController();
    this.queue.reset();
    this.sent.clear();
    this.starting = undefined;
    this.pending = 0;
  }

  /** The socket of the nvim server; starts nvim@main.service once when it is missing and waits up to 5 s. */
  async ensure(): Promise<string> {
    const socket = this.deps.env.PI_NVIM_SERVER;
    if (!socket) throw new Error(`lsp: ${noEnv}`);
    if (this.deps.exists(socket)) return socket;
    this.starting ??= this.start(socket);
    await this.starting;
    if (this.deps.exists(socket)) return socket;
    throw new Error(`lsp: ${noServer(socket)}`);
  }

  private async start(socket: string): Promise<void> {
    let result: RunResult;
    try {
      result = await this.deps.run("systemctl", ["--user", "start", "nvim@main.service"]);
    } catch (err) {
      throw new Error(`lsp: cannot start nvim@main.service: ${text(err)}`, { cause: err });
    }
    if (result.code !== 0) throw new Error(`lsp: cannot start nvim@main.service: ${result.stderr.trim() || `exit ${result.code}`}`);
    for (let i = 0; i < 50 && !this.deps.exists(socket); i++) await this.deps.sleep(100);
  }

  /** Starts a background check for an edited file; a newer edit of the same file replaces a pending run. */
  afterEdit(path: string, cwd: string): Promise<void> {
    const file = absolutePath(path, cwd);
    const session = this.session.signal;
    this.pending++;
    const run = this.queue.schedule(file, async (isCurrent) => {
      if (session.aborted || !isCurrent()) return;
      try {
        await this.check(file, session, isCurrent);
      } catch (err) {
        if (!session.aborted && isCurrent()) this.report(text(err));
      }
    });
    return run.finally(() => {
      if (!session.aborted) this.pending--;
    });
  }

  /** Ends when the runs after an edit end; true when one of them gave a message to notify. */
  editsDone(): Promise<boolean> | undefined {
    if (this.pending === 0) return undefined;
    const sent = this.sent.size;
    const session = this.session.signal;
    return this.queue.idle().then(() => !session.aborted && this.sent.size > sent);
  }

  private async check(file: string, session: AbortSignal, isCurrent: () => boolean): Promise<void> {
    const stale = () => session.aborted || !isCurrent();
    const server = await this.ensure();
    if (stale()) return;
    const before = this.read(file);
    const reply = (await this.remote(server, findBufferExpr(file), "finding the buffer")) as BufferReply;
    if (stale()) return;
    if (typeof reply.buf !== "number") throw new Error(`lsp: nvim gave no buffer for ${file}`);
    if (reply.modified) {
      this.report(conflict(file));
      return;
    }
    const buf = reply.buf;
    try {
      const verdict = await this.poll(server, buf, stale);
      if (verdict === "stale" || verdict === "none") return;
      if (verdict === "timeout") throw new Error(noResult(file));
      const result = (await this.remote(server, readDiagnosticsExpr(buf), "reading the diagnostics")) as DiagnoseReply;
      if (stale()) return;
      if (this.read(file) !== before) return;
      const diagnostics = Array.isArray(result.diagnostics) ? (result.diagnostics as Diagnostic[]) : [];
      if (diagnostics.length) this.report(formatDiagnostics(file, diagnostics));
    } finally {
      if (reply.created) await this.remote(server, wipeBufferExpr(buf), "wiping the buffer").catch(() => {});
    }
  }

  private async poll(server: string, buf: number, stale: () => boolean): Promise<"done" | "none" | "timeout" | "stale"> {
    const start = this.deps.now();
    let counter = 0;
    let changedAt = start;
    for (;;) {
      if (stale()) return "stale";
      const reply = (await this.remote(server, pollBufferExpr(buf), "polling the diagnostics")) as PollReply;
      const now = this.deps.now();
      const sample = { clients: typeof reply.clients === "number" ? reply.clients : 0, counter: typeof reply.counter === "number" ? reply.counter : 0 };
      if (sample.counter !== counter) {
        counter = sample.counter;
        changedAt = now;
      }
      const verdict = pollDecision({ clients: sample.clients, counter }, now - start, now - changedAt);
      if (verdict !== "wait") return verdict;
      await this.deps.sleep(POLL_MS);
    }
  }

  private async remote(server: string, expr: string, what: string): Promise<unknown> {
    let result: RunResult;
    try {
      result = await this.deps.run(this.deps.nvim, ["--clean", "--headless", "--server", server, "--remote-expr", expr]);
    } catch (err) {
      throw new Error(`lsp: ${what} failed on the nvim server ${server}: ${text(err)}`, { cause: err });
    }
    if (result.code !== 0) throw new Error(`lsp: ${what} failed on the nvim server ${server}: ${result.stderr.trim() || `exit ${result.code}`}`);
    const out = result.stdout.trim();
    if (!out) throw new Error(`lsp: ${what} on the nvim server ${server} gave no result`);
    try {
      return JSON.parse(out);
    } catch (err) {
      throw new Error(`lsp: ${what} on the nvim server ${server} gave no JSON: ${out.slice(0, 200)}`, { cause: err });
    }
  }

  private read(file: string): string | undefined {
    try {
      return this.deps.read(file);
    } catch {
      return undefined;
    }
  }

  private report(message: string): void {
    if (this.sent.has(message)) return;
    this.sent.add(message);
    this.notify(message);
  }
}
