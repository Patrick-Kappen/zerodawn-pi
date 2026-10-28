import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { RunResult } from "../../../shared/pair.ts";
import { absolutePath } from "../../../shared/util.ts";

export type Exec = (command: string, args: string[]) => Promise<RunResult>;
export type Diagnostic = { line: number; col: number; source: string; message: string };
export type LoadResult = { buf: number; modified: boolean; created: boolean };
export type PollResult = { clients: number; changes: number; busy: number; quiet: number };
export type Notify = (text: string) => void;

export const NO_CLIENT_MS = 2_000;
export const STABLE_MS = 500;
export const QUIET_MS = 3_000;
export const TIMEOUT_MS = 15_000;
export const POLL_MS = 200;
export const START_WAIT_MS = 5_000;
export const START_POLL_MS = 250;

/** A Lua string argument for luaeval; Vim single-quoted strings double a single quote and keep backslashes. */
export const luaString = (text: string) => `'${text.replaceAll("'", "''")}'`;

const luaCall = (body: string, arg: string | number) => `luaeval('${body}', ${typeof arg === "number" ? arg : luaString(arg)})`;

const LOAD_BODY = [
  "(function(file)",
  "local buf = -1",
  "for _, b in ipairs(vim.api.nvim_list_bufs()) do",
  "local name = vim.api.nvim_buf_get_name(b)",
  'if name == file or vim.fn.fnamemodify(name, ":p") == file then buf = b break end',
  "end",
  "local created = false",
  "if buf == -1 then buf = vim.fn.bufadd(file) vim.bo[buf].buflisted = false created = true vim.b[buf].pi_lsp_owned = true end",
  "vim.fn.bufload(buf)",
  "if vim.bo[buf].modified then return vim.json.encode({buf = buf, modified = true, created = created}) end",
  'if not created then vim.api.nvim_buf_call(buf, function() vim.cmd("edit!") end) end',
  "if vim.b[buf].pi_lsp_owned then vim.bo[buf].buflisted = false end",
  "vim.b[buf].pi_lsp_changes = 0",
  'local group = vim.api.nvim_create_augroup("PiLsp" .. buf, {clear = true})',
  'vim.api.nvim_create_autocmd("DiagnosticChanged", {group = group, buffer = buf, callback = function() vim.b[buf].pi_lsp_changes = (vim.b[buf].pi_lsp_changes or 0) + 1 end})',
  // vtsls sends no diagnostics for a clean file it did not check before: the end of LSP progress marks the result.
  "vim.b[buf].pi_lsp_busy = 0 vim.b[buf].pi_lsp_last = vim.uv.now()",
  'vim.api.nvim_create_autocmd("LspAttach", {group = group, buffer = buf, callback = function() vim.b[buf].pi_lsp_last = vim.uv.now() end})',
  'vim.api.nvim_create_autocmd("LspProgress", {group = group, callback = function(ev)',
  "if not vim.api.nvim_buf_is_valid(buf) or not vim.lsp.buf_is_attached(buf, ev.data.client_id) then return end",
  "local kind = ev.data.params.value.kind",
  'if kind == "begin" then vim.b[buf].pi_lsp_busy = vim.b[buf].pi_lsp_busy + 1 elseif kind == "end" then vim.b[buf].pi_lsp_busy = math.max(0, vim.b[buf].pi_lsp_busy - 1) end',
  "vim.b[buf].pi_lsp_last = vim.uv.now()",
  "end})",
  "return vim.json.encode({buf = buf, modified = false, created = created})",
  "end)(_A)",
].join(" ");

/** An expression that finds the buffer, makes pi's own buffer unlisted, reloads the user's buffer, and starts the diagnostic counter. */
export const loadExpr = (file: string) => luaCall(LOAD_BODY, file);

const POLL_BODY = [
  "(function(buf)",
  "local clients = #vim.lsp.get_clients({bufnr = buf})",
  "local last = vim.b[buf].pi_lsp_last or vim.uv.now()",
  "return vim.json.encode({clients = clients, changes = vim.b[buf].pi_lsp_changes or 0, busy = vim.b[buf].pi_lsp_busy or 0, quiet = vim.uv.now() - last})",
  "end)(_A)",
].join(" ");

/** An expression with the attached LSP client count, the DiagnosticChanged counter, the open LSP progress and the ms since the last LSP event of the buffer. */
export const pollExpr = (buf: number) => luaCall(POLL_BODY, buf);

const DIAGNOSTICS_BODY = [
  "(function(buf)",
  "local list = vim.diagnostic.get(buf, {severity = vim.diagnostic.severity.ERROR})",
  "local out = {}",
  "for _, d in ipairs(list) do",
  'table.insert(out, {line = d.lnum + 1, col = d.col + 1, source = d.source or "", message = d.message})',
  "end",
  "return vim.json.encode(out)",
  "end)(_A)",
].join(" ");

/** An expression with the ERROR diagnostics of the buffer as JSON, with 1-based line and column. */
export const diagnosticsExpr = (buf: number) => luaCall(DIAGNOSTICS_BODY, buf);

const WIPE_BODY = [
  "(function(buf)",
  'pcall(vim.api.nvim_del_augroup_by_name, "PiLsp" .. buf)',
  "if vim.api.nvim_buf_is_valid(buf) then vim.api.nvim_buf_delete(buf, {force = true}) end",
  'return "ok"',
  "end)(_A)",
].join(" ");

/** An expression that wipes a buffer that pi created. */
export const wipeExpr = (buf: number) => luaCall(WIPE_BODY, buf);

const RELEASE_BODY = ["(function(buf)", 'pcall(vim.api.nvim_del_augroup_by_name, "PiLsp" .. buf)', 'return "ok"', "end)(_A)"].join(" ");

/** An expression that removes pi's autocmds from a buffer of the user. */
export const releaseExpr = (buf: number) => luaCall(RELEASE_BODY, buf);

function object(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`LSP: nvim gave no JSON object: ${text.slice(0, 200)}`);
  return value as Record<string, unknown>;
}

export function parseLoad(text: string): LoadResult {
  const raw = object(text);
  if (typeof raw.buf !== "number" || typeof raw.modified !== "boolean" || typeof raw.created !== "boolean")
    throw new Error(`LSP: nvim gave an unexpected buffer state: ${text.slice(0, 200)}`);
  return { buf: raw.buf, modified: raw.modified, created: raw.created };
}

export function parsePoll(text: string): PollResult {
  const raw = object(text);
  if (typeof raw.clients !== "number" || typeof raw.changes !== "number" || typeof raw.busy !== "number" || typeof raw.quiet !== "number")
    throw new Error(`LSP: nvim gave an unexpected poll result: ${text.slice(0, 200)}`);
  return { clients: raw.clients, changes: raw.changes, busy: raw.busy, quiet: raw.quiet };
}

export function parseDiagnostics(text: string): Diagnostic[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error(`LSP: nvim gave no JSON list of diagnostics: ${text.slice(0, 200)}`);
  return value.map((entry) => {
    const raw = entry as Record<string, unknown>;
    if (typeof raw.line !== "number" || typeof raw.col !== "number" || typeof raw.message !== "string")
      throw new Error(`LSP: nvim gave an unexpected diagnostic: ${JSON.stringify(entry).slice(0, 200)}`);
    return { line: raw.line, col: raw.col, source: typeof raw.source === "string" ? raw.source : "", message: raw.message };
  });
}

export function errorMessage(rel: string, diagnostics: Diagnostic[]): string {
  const lines = diagnostics.map((d) => `${d.line}:${d.col} ${d.source ? `${d.source}: ` : ""}${d.message}`);
  return [`LSP errors after the edit of ${rel}:`, ...lines].join("\n");
}

export const unsavedMessage = (rel: string) => `LSP: the user has unsaved changes in ${rel} in nvim, LSP not checked.`;

export const timeoutMessage = (rel: string) => `LSP gave no result for ${rel} in ${TIMEOUT_MS / 1000} s`;

export const socketMessage = (socket: string, reason: string) =>
  `LSP: the nvim server ${socket} does not answer (${reason}). Start it with systemctl --user start nvim@main.service and check journalctl --user -u nvim@main.`;

export type Deps = {
  server: string;
  nvim: string;
  exec: Exec;
  sleep: (ms: number) => Promise<void>;
  read: (path: string) => string | undefined;
  now: () => number;
};

export const defaultRead = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

/**
 * Checks the LSP diagnostics of each edited file in the user's nvim server.
 * Runs one check at a time, replaces a waiting check of the same file, drops a result when the file
 * changed, and sends the same message once per session.
 */
export class LspChecks {
  private edits = new Map<string, number>();
  private sent = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private session = new AbortController();
  private serviceStarted = false;

  constructor(
    private readonly deps: Deps,
    private readonly notify: Notify,
  ) {}

  reset() {
    this.edits.clear();
    this.sent.clear();
    this.queue = Promise.resolve();
    this.pending = 0;
    this.serviceStarted = false;
    this.session.abort();
    this.session = new AbortController();
  }

  /** Checks one edited file in the background, after the checks that wait before it. */
  afterEdit(_toolCallId: string, path: string, cwd: string): Promise<void> {
    const file = absolutePath(path, cwd);
    const rel = relative(cwd, file) || file;
    const edit = (this.edits.get(file) ?? 0) + 1;
    this.edits.set(file, edit);
    const before = this.deps.read(file);
    const session = this.session.signal;
    const run = async () => {
      if (session.aborted || this.edits.get(file) !== edit) return;
      let message: string | undefined;
      try {
        message = await this.check(file, rel, session);
      } catch (err) {
        const text = (err as Error).message;
        message = text.startsWith("LSP") ? text : `LSP: the check of ${rel} failed: ${text}`;
      }
      if (session.aborted || !message || this.deps.read(file) !== before) return;
      if (this.sent.has(message)) return;
      this.sent.add(message);
      this.notify(message);
    };
    this.pending++;
    this.queue = this.queue.then(run).finally(() => {
      if (!session.aborted) this.pending--;
    });
    return this.queue;
  }

  /** Ends when the checks after edits end; true when one of them sent a message. undefined when none runs. */
  editsDone(): Promise<boolean> | undefined {
    if (this.pending === 0) return undefined;
    const sent = this.sent.size;
    const session = this.session.signal;
    return this.queue.then(() => !session.aborted && this.sent.size > sent);
  }

  /** The message for one file, or undefined for a clean result and for a file type without LSP. */
  async check(file: string, rel: string, signal: AbortSignal): Promise<string | undefined> {
    const load = parseLoad(await this.remote(loadExpr(file), signal));
    if (load.modified) return unsavedMessage(rel);
    try {
      const start = this.deps.now();
      let changes = 0;
      let stable = 0;
      for (;;) {
        if (signal.aborted) return undefined;
        const poll = parsePoll(await this.remote(pollExpr(load.buf), signal));
        const elapsed = this.deps.now() - start;
        if (poll.clients === 0 && elapsed >= NO_CLIENT_MS) return undefined;
        if (poll.clients > 0 && poll.changes === 0 && poll.busy === 0 && poll.quiet >= QUIET_MS) return undefined;
        if (poll.clients > 0 && poll.changes > 0) {
          if (poll.changes !== changes) {
            changes = poll.changes;
            stable = this.deps.now();
          } else if (this.deps.now() - stable >= STABLE_MS) break;
        }
        if (elapsed >= TIMEOUT_MS) return timeoutMessage(rel);
        await this.deps.sleep(POLL_MS);
      }
      const diagnostics = parseDiagnostics(await this.remote(diagnosticsExpr(load.buf), signal));
      return diagnostics.length ? errorMessage(rel, diagnostics) : undefined;
    } finally {
      await this.remote(load.created ? wipeExpr(load.buf) : releaseExpr(load.buf), signal, false);
    }
  }

  /** Runs one nvim expression; a socket that does not answer gets one service start and a loud error. */
  private async remote(expr: string, signal: AbortSignal, mayStart = true): Promise<string> {
    if (signal.aborted) throw new Error("LSP: the session ended");
    try {
      return await this.run(expr);
    } catch (err) {
      if (!mayStart) throw err;
      const reason = (err as Error).message;
      const started = await this.startServer(signal);
      if (!started) throw new Error(socketMessage(this.deps.server, reason));
      try {
        return await this.run(expr);
      } catch (again) {
        throw new Error(socketMessage(this.deps.server, (again as Error).message));
      }
    }
  }

  private async run(expr: string): Promise<string> {
    const result = await this.deps.exec(this.deps.nvim, ["--clean", "--headless", "--server", this.deps.server, "--remote-expr", expr]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `exit ${result.code}`);
    return result.stdout.trim();
  }

  private async startServer(signal: AbortSignal): Promise<boolean> {
    if (this.serviceStarted) return false;
    this.serviceStarted = true;
    const start = await this.deps.exec("systemctl", ["--user", "start", "nvim@main.service"]);
    if (start.code !== 0) throw new Error(socketMessage(this.deps.server, `systemctl failed: ${start.stderr.trim()}`));
    const end = this.deps.now() + START_WAIT_MS;
    for (;;) {
      if (signal.aborted) return false;
      try {
        await this.run("1");
        return true;
      } catch {
        // The server has not opened the socket yet.
      }
      if (this.deps.now() >= end) return false;
      await this.deps.sleep(START_POLL_MS);
    }
  }
}
