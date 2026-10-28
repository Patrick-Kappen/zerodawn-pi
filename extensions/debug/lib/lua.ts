// The Lua side runs in the user's Neovim server through luaeval. The script uses only single quotes, so it fits in a
// Vim double-quoted string without escapes; see expression().

const SOURCE = `
local p = vim.json.decode(_A)
local d = _G.__pi_debug
if not d then
  d = { output = {}, created = {}, breakpoints = {}, generation = 0 }
  _G.__pi_debug = d
  local ok, dp = pcall(require, 'dap')
  if ok then
    dp.listeners.after.event_output['pi-debug'] = function(_, body)
      if type(body.output) == 'string' then table.insert(d.output, body.output) end
    end
    dp.listeners.after.event_exited['pi-debug'] = function(_, body) d.exited = body.exitCode end
    dp.listeners.after.event_terminated['pi-debug'] = function() d.terminated = true end
    dp.listeners.after.event_stopped['pi-debug'] = function(_, body)
      d.reason = body.reason
      d.description = body.description or body.text
    end
  end
end

local function encode(value) return vim.json.encode(value) end
local function fail(message) return encode({ error = message }) end

local function dap()
  local ok, mod = pcall(require, 'dap')
  if not ok then return nil end
  return mod
end

local function take_output()
  local text = table.concat(d.output)
  d.output = {}
  return text
end

local function unlist()
  for _, b in ipairs(d.created) do
    if vim.api.nvim_buf_is_valid(b) then vim.bo[b].buflisted = false end
  end
end

local function cleanup()
  pcall(function()
    local bps = require('dap.breakpoints')
    for _, bp in ipairs(d.breakpoints) do
      pcall(bps.remove, bp.buf, bp.line)
    end
  end)
  d.breakpoints = {}
  for _, b in ipairs(d.created) do
    if vim.api.nvim_buf_is_valid(b) and not vim.bo[b].modified then
      pcall(vim.api.nvim_buf_delete, b, { force = true })
    end
  end
  d.created = {}
  d.owned = nil
  d.starting = false
  d.stopping = false
  d.frames = nil
  d.locals = nil
  d.details_ready = false
end

local function open_buffer(file)
  local bufnr = vim.fn.bufnr(file)
  if bufnr == -1 then
    bufnr = vim.fn.bufadd(file)
    table.insert(d.created, bufnr)
    vim.fn.bufload(bufnr)
    vim.bo[bufnr].buflisted = false
  end
  return bufnr
end

local function fetch_details(session)
  d.frames = nil
  d.locals = nil
  d.source = nil
  d.details_error = nil
  d.details_ready = false
  session:request('stackTrace', { threadId = session.stopped_thread_id, startFrame = 0, levels = 10 }, function(err, resp)
    if err then
      d.details_error = err.message
      d.details_ready = true
      return
    end
    local frames = (resp and resp.stackFrames) or {}
    d.frames = {}
    for _, frame in ipairs(frames) do
      table.insert(d.frames, {
        name = frame.name,
        file = frame.source and frame.source.path or nil,
        line = frame.line,
      })
    end
    local top = frames[1]
    if top and top.source and top.source.path and top.line then
      local ok, lines = pcall(vim.fn.readfile, top.source.path, '', top.line)
      if ok and #lines > 0 then d.source = lines[#lines] end
    end
    if not top then
      d.details_ready = true
      return
    end
    session:request('scopes', { frameId = top.id }, function(scope_err, scope_resp)
      if scope_err then
        d.details_error = scope_err.message
        d.details_ready = true
        return
      end
      local scopes = {}
      for _, s in ipairs((scope_resp and scope_resp.scopes) or {}) do
        if not s.expensive and s.name ~= 'Global' and s.name ~= 'Module' then table.insert(scopes, s) end
      end
      d.locals = {}
      if #scopes == 0 then
        d.details_ready = true
        return
      end
      local pending = #scopes
      for _, scope in ipairs(scopes) do
        local current = scope
        session:request('variables', { variablesReference = current.variablesReference }, function(var_err, var_resp)
          if not var_err then
            table.insert(d.locals, { name = current.name, variables = (var_resp and var_resp.variables) or {} })
          end
          pending = pending - 1
          if pending == 0 then d.details_ready = true end
        end)
      end
    end)
  end)
end

local function ours_of(session)
  local s = session
  while s do
    if d.owned and s.id == d.owned then return true end
    s = s.parent
  end
  return false
end

local function status(dp)
  local r = {}
  local session = dp.session()
  local ours = session and not session.closed and ours_of(session)
  if d.starting and session and not session.closed then
    local root = session
    while root.parent do root = root.parent end
    d.owned = root.id
    d.starting = false
    ours = true
  end
  unlist()
  if session and not session.closed and not ours then
    r.status = 'foreign'
    r.session = session.id
  elseif ours and session then
    if session.stopped_thread_id then
      r.status = 'stopped'
      r.reason = d.reason
      if d.detail_gen ~= d.generation then
        d.detail_gen = d.generation
        fetch_details(session)
      end
      r.details = d.details_ready
      r.frames = d.frames
      r.locals = d.locals
      r.source = d.source
      r.details_error = d.details_error
    else
      r.status = 'running'
    end
  elseif d.starting then
    r.status = 'starting'
  elseif d.owned then
    r.status = 'terminated'
  else
    r.status = 'idle'
  end
  r.output = take_output()
  r.exit_code = d.exited
  r.terminated = d.terminated or false
  if r.status == 'terminated' and d.cleaned_generation ~= d.generation then
    d.cleaned_generation = d.generation
    cleanup()
  end
  return r
end

if p.op == 'buffers' then
  local buffers = {}
  for _, file in ipairs(p.files or {}) do
    local bufnr = open_buffer(file)
    table.insert(buffers, { file = file, buffer = bufnr, listed = vim.bo[bufnr].buflisted == true, modified = vim.bo[bufnr].modified })
  end
  return encode({ buffers = buffers })
end

if p.op == 'wipe' then
  local kept = {}
  for _, b in ipairs(d.created) do
    if vim.api.nvim_buf_is_valid(b) then
      if vim.bo[b].modified then
        table.insert(kept, b)
      else
        pcall(vim.api.nvim_buf_delete, b, { force = true })
      end
    end
  end
  d.created = kept
  return encode({ kept = kept })
end

if p.op == 'status' then
  local dp = dap()
  if not dp then return fail('nvim-dap is not installed or not set up in the Neovim server') end
  return encode(status(dp))
end

if p.op == 'start' then
  local dp = dap()
  if not dp then return fail('nvim-dap is not installed or not set up in the Neovim server') end
  local session = dp.session()
  if session and not session.closed then
    if ours_of(session) then
      return fail('a pi debug session is already running; use continue, step_over, step_into, step_out or stop')
    end
    return fail('the Neovim server has its own dap session running; stop it before pi starts a debug session')
  end
  if not dp.adapters[p.config.type] then
    return fail('nvim-dap has no adapter ' .. p.config.type .. '; available: ' .. table.concat(vim.tbl_keys(dp.adapters), ', '))
  end
  cleanup()
  d.output = {}
  d.exited = nil
  d.terminated = false
  d.reason = nil
  d.description = nil
  d.generation = (d.generation or 0) + 1
  d.detail_gen = nil
  d.starting = true
  d.owned = nil
  for _, bp in ipairs(p.breakpoints or {}) do
    local bufnr = open_buffer(bp.file)
    local count = vim.api.nvim_buf_line_count(bufnr)
    if bp.line < 1 or bp.line > count then
      cleanup()
      return fail('breakpoint line ' .. bp.line .. ' is outside ' .. bp.file .. ' (' .. count .. ' lines)')
    end
    require('dap.breakpoints').set({ condition = bp.condition }, bufnr, bp.line)
    table.insert(d.breakpoints, { buf = bufnr, line = bp.line })
  end
  open_buffer(p.config.program)
  local ok, err = pcall(dp.run, p.config)
  if not ok then
    cleanup()
    return fail('dap.run failed: ' .. tostring(err))
  end
  return encode({ ok = true })
end

if p.op == 'continue' or p.op == 'step_over' or p.op == 'step_into' or p.op == 'step_out' then
  local dp = dap()
  if not dp then return fail('nvim-dap is not installed or not set up in the Neovim server') end
  local session = dp.session()
  if not session or session.closed then return fail('no debug session is running; use action start') end
  if not ours_of(session) then return fail('the Neovim server has its own dap session running; pi does not control it') end
  if not session.stopped_thread_id then return fail('the program is running; wait for a stop before you continue or step') end
  d.generation = d.generation + 1
  d.detail_gen = nil
  d.reason = nil
  d.description = nil
  if p.op == 'continue' then
    dp.continue()
  elseif p.op == 'step_over' then
    dp.step_over()
  elseif p.op == 'step_into' then
    dp.step_into()
  else
    dp.step_out()
  end
  return encode({ ok = true })
end

if p.op == 'eval' then
  local dp = dap()
  if not dp then return fail('nvim-dap is not installed or not set up in the Neovim server') end
  local session = dp.session()
  if not session or session.closed then return fail('no debug session is running; use action start') end
  if not ours_of(session) then return fail('the Neovim server has its own dap session running; pi does not control it') end
  if not session.stopped_thread_id or not session.current_frame then return fail('the program is not stopped at a frame; use continue first') end
  d.eval = nil
  session:evaluate({ expression = p.expression, context = 'repl' }, function(err, resp)
    if err then
      d.eval = { ok = false, error = err.message }
    else
      d.eval = { ok = true, value = (resp and resp.result) or '' }
    end
  end)
  return encode({ pending = true })
end

if p.op == 'eval_poll' then
  return encode({ eval = d.eval })
end

if p.op == 'stop' then
  local dp = dap()
  if not dp then return encode({ stopped = true }) end
  local session = dp.session()
  if session and not session.closed and ours_of(session) then
    d.stopping = true
    pcall(dp.terminate, {}, { terminateDebuggee = true })
    return encode({ stopping = true })
  end
  cleanup()
  return encode({ stopped = true })
end

return fail('unknown action ' .. tostring(p.op))
`;

/** The Lua source with its indentation collapsed: Lua does not need newlines, and a Vim string literal cannot hold them. */
export const LUA = SOURCE.replace(/\n\s*/g, " ").trim();

/** One Vim double-quoted string literal. The Lua source has no double quotes or backslashes; the payload is escaped here. */
function vimString(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** The --remote-expr value: decode the payload in Lua and run the script. */
export function expression(payload: unknown): string {
  return `luaeval(${vimString(`(function() ${LUA} end)()`)}, ${vimString(JSON.stringify(payload))})`;
}

function unescapeVim(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    i++;
    out += text[i] ?? "";
  }
  return out;
}

/** The payload of an expression, for tests and diagnostics. */
export function payloadOf(expr: string): unknown {
  const match = /^luaeval\("(?:[^"\\]|\\.)*", "((?:[^"\\]|\\.)*)"\)$/.exec(expr);
  if (!match) throw new Error(`debug: not a pi debug expression: ${expr.slice(0, 80)}`);
  return JSON.parse(unescapeVim(match[1]));
}
