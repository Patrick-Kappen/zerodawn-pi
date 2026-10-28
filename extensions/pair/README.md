# pair

| Command | What |
|---|---|
| `/ide` | moves the paired Neovide to the current worktree and focuses its window through `hyprctl` (Hyprland); without a pair, starts Neovide on a socket, pairs this tmux client with it and starts the pair |

On every session start, resume, new and fork, the pi session id is set as the tmux pane option `@pair-agent-session` of `$TMUX_PANE`. Nothing happens outside tmux.

Needs the zerodawn-tmux addon `pair` and the zerodawn-nvim addon `pair` (`require("zerodawn.pair")` set up in nvim).

## Environment

| Variable | What |
|---|---|
| `PI_PAIR_COMMAND`, `PI_PAIR_TMUX` | pair script and tmux wrapper, as in `projects` |
| `PI_IDE_NEOVIDE` | Neovide command (default `neovide`) |
| `PI_IDE_NVIM` | nvim command to reach the server (default `nvim`) |
