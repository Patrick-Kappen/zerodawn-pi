# projects

`/switch` and alt+p open a popup picker, like the picker of the zerodawn-nvim addon `projects`. It moves the tmux/nvim pair (zerodawn-tmux addon `pair`) to a project or worktree. Built with `@narumitw/pi-tui-kit`.

| Key | What |
|---|---|
| type | filter; a path (`/…`, `~/…`, `./…`) is accepted as typed |
| up / down, enter | choose and switch the pair with `pair open` |
| tab | next scope: open, worktrees, projects, then open again |
| ctrl-n | new worktree and branch next to the main worktree, then switch |
| ctrl-d | remove the worktree (worktrees scope); confirms when pi runs there |
| esc | close |

The picker always starts on `open`, the open worktree windows of `pair list`. `worktrees` are the worktrees of the current repo. `projects` are the recent folders of `zoxide`. `●` open, `○` not open, `π` pi runs in the window.

## Environment

| Variable | What |
|---|---|
| `PI_PAIR_COMMAND` | the pair script (default `pair` on PATH) |
| `PI_PAIR_TMUX` | tmux wrapper, passed as `--tmux` |

Needs pi inside tmux (`$TMUX_PANE`), a paired client (`/ide` starts it), and `zoxide`, `git`.

## Changes

<!-- changelog:start -->
## 0.2.0 — 2026-10-28

- /switch requires PI_PAIR_COMMAND

- mark pi when any window of a folder runs it

- popup picker with open, worktrees and projects scopes

[All changes](CHANGELOG.md)
<!-- changelog:end -->
