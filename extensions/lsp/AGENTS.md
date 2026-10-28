# lsp

- The nvim server is the user's own: `$PI_LSP_SERVER`, started by systemd as `nvim@main`.
- Never report "no errors" when the server or the query failed: send a loud error instead.
- Never wait inside nvim (no `vim.wait`); poll from TypeScript with short remote-expr calls.
- The Lua expressions stay one line, in single-quoted Vim strings; use double quotes inside Lua.
