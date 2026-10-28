# lsp

Reports LSP errors to the agent after each `edit` or `write`. It uses the user's already-running nvim server, so it sees the same LSP servers and settings as the editor.

## After an edit

The extension starts one check per edited file in the background. The checks run one after another; a newer edit of the same file replaces a check that did not start yet. It never blocks the tool result.

1. nvim gets the absolute file path. When a buffer exists with unsaved changes, the agent gets `<file> has unsaved changes in nvim; LSP check skipped` and nothing is reloaded. Else an existing buffer is reloaded from disk without changing windows. A missing buffer is created with `bufadd` and `bufload`, stays unlisted, and gets `filetype detect` and `doautocmd BufRead` so the LSP attaches. The extension remembers that pi created that buffer.
2. A `DiagnosticChanged` counter in a buffer variable shows when the LSP answered. TypeScript samples it every 200 ms for at most 15 s. A counter above zero that held still for 500 ms is the result. No attached client after 3 s means there is no LSP for this filetype: no message, not an error. An attached client without a result in 15 s is `LSP gave no result for <file> in 15 s`.
3. Only errors count. They arrive as one message with `<file>:<line>:<col> <source>: <message>` per error, as a steer message during a run and as a new turn otherwise. A clean file gives no message, and the same message comes once. A result is dropped when the file changed on disk during the check.
4. A buffer that pi created is wiped afterwards, also when the check fails or times out.

In print and json mode the agent waits for the checks before it settles, because a message needs a run to be read.

## Environment

| Variable | What |
|---|---|
| `PI_NVIM_SERVER` | the nvim server socket, for example `$XDG_RUNTIME_DIR/nvim/main.sock`; set by the Home Manager configuration |

Without `PI_NVIM_SERVER` the session start says `PI_NVIM_SERVER is not set; LSP checks are off.` and no check runs.

When the socket does not exist, the extension runs `systemctl --user start nvim@main.service` once and waits up to 5 s for the socket. A socket that does not appear is a clear error to the agent, not a silent clean result.

## Needs

`nvim`, from `config().nvim` or `PATH`. A running nvim server that has the LSP servers of the project. A systemd user service `nvim@main.service` that starts that server when it is not running.

## Constants

`lib/poll.ts`: `POLL_MS`, `CLIENT_WAIT_MS`, `STABLE_MS`, `TIMEOUT_MS`.

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-28

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
