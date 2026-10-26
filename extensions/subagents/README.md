# subagents

Delegate tasks to pi agents. Each agent runs as a normal interactive pi in a window of a detached tmux session.

Status: work in progress. The tool `subagent` has one action, `status`: it starts or finds the supervisor, connects, and shows the status. No agent starts yet.

## Design

- One detached tmux session per main agent: `pi-sub-<first 8 characters of its pi session id>`.
- Window 0 runs the supervisor. Each subagent gets its own window.
- The supervisor owns the subagents:
  - It starts and stops them.
  - It sends their events to the main pi, so the tool calls show in the UI.
  - It shows an overview of all agents in window 0.
- The main pi and the subagents are clients. They connect to one Unix socket of the supervisor. The tmux option `@pi-sub-socket` on the session holds its path.
- Each subagent has a real pi session (`--session-id`, `--session-dir`), so the tool can resume it later.
- Runtime files go to `/tmp/pi-sub-<id>/`: the register of the subagents (id, role, window, status) and their pi sessions. A reboot removes them.

## Lifecycle

- When the main pi stops, the running subagents finish their task. Then the supervisor closes the session.
- 2 hours after the main pi stops, the supervisor stops all subagents and closes the session. This also cleans up after a crash.
- When no main pi connects within 2 hours after the supervisor starts, the supervisor closes the session.

## UI (planned)

The same kind of view as the `bash` extension:

| bash | subagent |
|---|---|
| The tool waits and streams the last 40 lines | The tool waits and streams the last tool calls and text of the subagent |
| `background: true` returns an id; a `bash-job` message reports the result | The same, with a `subagent` message |
| `jobs wait / list / kill` | Tool `subagents`: `wait`, `list`, `abort` |
| `/jobs`, `ctrl+shift+j` follow a job | `/subagents` follows a subagent and shows `tmux attach -t pi-sub-<id>` |
| Dashboard: status, time, last lines | Dashboard: each subagent with status, time, current tool call, cost |
| `session_start` reports jobs that ended | `session_start` finds a running `pi-sub-<id>`, connects, reports what ended |

The main pi connects to the supervisor when the first subagent starts. At `session_start` it only looks for a running session.

## Watch

`tmux attach -t pi-sub-<id>`. Window 0 shows the overview; the other windows show each subagent.

## Needs

- `tmux` and `pi` in `PATH`.
