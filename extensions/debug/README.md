# debug

One tool, `debug`, that debugs a program or a failing test through the user's running Neovim server and nvim-dap. The tool exists only when `PI_DEBUG_SERVER` names the server socket.

## Actions

- `start` `{file, breakpoints, adapter?, args?}`: sets breakpoints, runs the file and waits for a stop, the end of the program, or 30 s. The adapter comes from the extension: `.py` python, `.go` delve (`_test.go` runs `go test`), anything else `pwa-node` (TypeScript runs with type stripping).
- `continue`, `step_over`, `step_into`, `step_out`: resume and wait the same way.
- `eval` `{expression}`: evaluates in the current frame.
- `stop`: terminates, clears the breakpoints pi set and wipes the buffers pi created.

A stop reports the reason, `file:line`, the source line, the top 10 stack frames, the locals of the top frame (values cut at 200 characters) and the program output since the last call. A terminated program reports the exit code and the output tail.

## Rules

- One pi debug session at a time. A dap session of the user is never touched; pi reports an error instead.
- Buffers pi opens are unlisted. Buffers the user modified are never wiped.
- If the socket does not answer, pi runs `systemctl --user start nvim@main.service` once and waits 5 s, then fails naming the socket and `journalctl --user -u nvim@main`.
- The session stops when the pi session ends.
- nvim is `nvim` in `config.json` (default `nvim`).

## Changes

<!-- changelog:start -->
## 0.1.1 — 2026-10-28

- README: add the changelog block

[All changes](CHANGELOG.md)
<!-- changelog:end -->
