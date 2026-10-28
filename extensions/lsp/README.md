# lsp

After each successful `edit` or `write`, asks the user's Neovim server for the LSP diagnostics of that file and tells the agent only about errors.

The extension is off unless `PI_LSP_SERVER` is set to the nvim socket, for example `$XDG_RUNTIME_DIR/nvim/main.sock`. The binary comes from `nvim` in `config.json` (default `nvim` on `PATH`).

## Behavior

1. In nvim, finds the buffer of the file. A modified buffer (unsaved changes in nvim) is not reloaded; the agent gets one message that the file was not checked. Otherwise the buffer is loaded unlisted, or an existing unmodified one is reloaded so its content is current. A buffer that pi created is wiped again at the end.
2. Polls the server from TypeScript until no LSP client is attached after 2 s (nothing to report), or until the `DiagnosticChanged` counter changed and stayed stable for 500 ms. After 15 s with clients attached, the agent gets one error that LSP gave no result.
3. Reads the ERROR diagnostics and sends one message: `LSP errors after the edit of <rel>:` with `line:col source: message` lines. A clean file sends no message.
4. The checks run in the background, one at a time. A newer edit of the same file replaces a waiting check, a result is dropped when the file changed meanwhile, and the same message is sent once.

If the socket does not answer, the extension starts `systemctl --user start nvim@main.service` once and waits up to 5 s. If it still fails, the agent gets one loud message naming the socket and `journalctl --user -u nvim@main`.

## Environment

| Variable | What |
|---|---|
| `PI_LSP_SERVER` | nvim socket of the user's server; unset means the extension does nothing |

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-28

- First release: LSP errors after each edit or write, from the user's Neovim server.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
