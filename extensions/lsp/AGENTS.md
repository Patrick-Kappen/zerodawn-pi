# lsp

The LSP checks after an edit, through the user's running nvim server. Read `README.md` for what it does.

- The nvim side is Lua in strings in `lib/run.ts`, because the package contains only `.ts` files. A call uses `nvim --clean --headless --server <socket> --remote-expr` and `luaeval` with the argument as `_A`; the result is `vim.json.encode`.
- Keep the pure parts pure: formatting in `lib/format.ts`, the poll decision in `lib/poll.ts`, the run order in `lib/queue.ts`.
- Never wait for nvim in `tool_result`: `afterEdit` runs in the background and only an error goes to the agent.
- A clean result and a filetype without an LSP client give no message. An unsaved buffer, a missing server and a timeout do.
- Wipe only the buffers that pi created, also on error paths.
- The integration test runs a real `nvim --headless --listen`; it needs `nvim` on `PATH` and must not skip.

## After a pi upgrade

- Make sure `tool_result` still runs after an `edit` or `write`, and that `sendMessage` with `triggerTurn` and `steer` still reaches the agent during a run.
- Make sure `agent_before_settle` can keep print and json mode open for a background result.
