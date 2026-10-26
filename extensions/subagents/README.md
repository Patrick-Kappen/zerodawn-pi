# subagents

Delegate tasks to pi agents. Each agent runs as a separate pi process in a window of a detached tmux session.

Status: work in progress. The extension registers no tool yet.

## Layout in tmux

- One detached session per main agent: `pi-sub-<first 8 characters of its pi session id>`.
- One window per subagent.
- Watch the subagents with `tmux attach -t pi-sub-<id>`.

## Needs

- `tmux` and `pi` in `PATH`.
