# subagents

Delegate tasks to pi agents. Each agent runs as a normal interactive pi in a window of a detached tmux session.

Status: work in progress. The tool `subagent` has two actions:

- `start` with `task`: the supervisor starts a pi agent (`anthropic/claude-haiku-5-5:off`) in a new window `sub-<first 4 characters of its id>`. The tool waits and returns the final answer.
- `status`: starts or finds the supervisor, connects, and shows the agents.

The result that the model sees is small: agent id, status, final text (cut at 8000 characters) and one line with tokens and cost. The last 20 events (200 characters each) go to `details` only.

## Design

- One detached tmux session per main agent: `pi-sub-<first 8 characters of its pi session id>`.
- Window 0 runs the supervisor. Each subagent gets its own window.
- The supervisor owns the subagents:
  - It starts and stops them.
  - It sends their events to the main pi, so the tool calls show in the UI.
  - It shows an overview of all agents in window 0.
- The main pi and the subagents are clients. They connect to one Unix socket of the supervisor. The tmux option `@pi-sub-socket` on the session holds its path.
- Each subagent has a real pi session (`--session-id`, `--session-dir`), so the tool can resume it later. The id is a UUID.
- The subagent loads this extension too. `PI_SUBAGENT_SOCKET` and `PI_SUBAGENT_ID` make it a client of the supervisor: it runs the task it gets and sends tool, message and settle events.
- Agent status: `starting`, `running`, `idle`, `failed`. An agent that does not connect within 30 s, or whose window is gone without a result, is `failed`. The supervisor checks the windows every 2 s.
- Runtime files go to `/tmp/pi-sub-<id>/`: the register of the subagents (id, role, window, status) and their pi sessions. A reboot removes them.

## What a subagent loads

The command is `pi -ne -ns -np -nc --no-themes -e <path> ... --model ... --session-id ... --session-dir ...`. The flags turn off extension discovery, skills, prompt templates, context files and themes. Tools stay on.

- The first `-e` is the subagents extension. It connects the subagent to the supervisor.
- The other `-e` paths come from `subagentExtensions` in `config.json`, in order. Use it for a provider login extension.
- Without `subagentExtensions`, the tool fails. Set `[]` to start with no extra extension.
- Later, an agent file adds its own prompt, tools and extensions.

`just dev` reads the `config.json` of the installed package (through `ZERODAWN_PI_CONFIG`) and loads its `subagentExtensions` in the sandbox pi too. Set the Home Manager option `subagentExtensions` to your provider login extension, for example `anthropic-oauth/index.ts`.

## Lifecycle

- When the main pi stops, the running subagents finish their task. When the last one ends, the supervisor closes the session at once.
- 2 hours after the main pi stops, the supervisor stops all subagents and closes the session. This also cleans up after a crash.
- A stale `@pi-sub-socket` (the supervisor crashed) is found when the main pi connects. When the window `supervisor` is gone, the option is unset and a new supervisor starts in the same session. When the window exists, the tool fails and names the session.
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
