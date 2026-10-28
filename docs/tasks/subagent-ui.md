# Build the subagents UI: streaming, background, tool, dashboard

Give subagents the same view as bash jobs: streaming, background start, a report message, a `subagents` tool, `/subagents` and a dashboard with cost. This is the last step of the plan.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md
- zerodawn-pi main: extensions/subagents/README.md (UI (planned))

## Original text

One step at a time. Each step is its own PR.

12. UI as in README "UI (planned)": streaming, background, messages, tool `subagents`, `/subagents`, dashboard.

README "UI (planned)":
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

README Plan: - **UI:** last.
