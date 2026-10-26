# subagents

Delegate tasks to pi agents. Each agent runs as a normal interactive pi in a window of a detached tmux session.

Status: work in progress. The tool `subagent` has three actions:

- `start` with `profile` and `task`: the supervisor starts a pi agent with that profile in a new window `sub-<first 4 characters of its id>`. The tool waits and returns the final answer.
- `answer` with `id` and `text`: sends `text` to the agent and waits for its next result, like `start`. The agent must have status `idle`, `question` or `blocked`.
- `status`: starts or finds the supervisor, connects, and shows the agents.

The result that the model sees is small: agent id, status, final text (cut at 8000 characters) and one line with tokens and cost. The last 20 events (200 characters each) go to `details` only.

Every subagent has two fixed tools, whatever its profile says: `ask { question }` and `blocker { reason }`. Both send the text to the supervisor and tell the model to stop and wait for a new message. The model uses `blocker` only after it tried to solve the problem within its task limits. When the agent settles, the result has status `question` or `blocked` and that text, not the final text. On `question`, the main agent answers with `answer`. On `blocked`, it first tries to solve the problem within its own limits, then sends the solution with `answer`. pi filters extension tools with `--tools` and `--no-tools`, so the main pi always adds `ask,blocker` to the `--tools` list.

## Design

- One detached tmux session per main agent: `pi-sub-<first 8 characters of its pi session id>`.
- Window 0 runs the supervisor. Each subagent gets its own window.
- The supervisor needs `--pi <command>` and `--extension <absolute path>`. The main pi passes `pi`.
- The supervisor owns the subagents:
  - It starts and stops them.
  - It sends their events to the main pi, so the tool calls show in the UI.
  - It shows an overview of all agents in window 0.
- The main pi and the subagents are clients. They connect to one Unix socket of the supervisor. The tmux option `@pi-sub-socket` on the session holds its path.
- Each subagent has a real pi session (`--session-id`, `--session-dir`), so the tool can resume it later. The id is a UUID.
- The subagent loads this extension too. `PI_SUBAGENT_SOCKET` and `PI_SUBAGENT_ID` make it a client of the supervisor: it runs the task it gets and sends tool, message and settle events.
- Agent status: `starting`, `running`, `idle`, `question`, `blocked`, `failed`. `question` and `blocked` count as not running. An agent that does not connect within 30 s, or whose window is gone without a result, is `failed`. The supervisor checks the windows every 2 s.
- Runtime files go to `/tmp/pi-sub-<id>/`: the register of the subagents (id, role, window, status) and their pi sessions. A reboot removes them.

## Done gate

The gate runs in the subagent, in its extension, on `agent_settled`. It uses the working directory of the subagent.

- A subagent with a pending `ask` or `blocker` skips the gate. Its question or blocker goes to the main agent.
- No changed file (git working tree against HEAD, with untracked files): the gate is green at once. A scout passes this way.
- A changed code file without a test: red. The subagent gets the file list and must add a test for each.
- The whole repository test set runs (recipe `test`, else `bun test`). Red, or any warning line: the subagent gets only the failures.
- Then each `checks` command of the profile runs in `bash -c`. The first red one goes back with its failures.
- All green: the result goes to the main agent as before, the final text of the subagent.

Red keeps the status `running`. The subagent sends a `gate` event with `green` or `red` and a one-line reason, so the event list shows it. There is no limit on tries yet. The main pi sends the `checks` of the profile in the `start` message; the supervisor gives them to the subagent in `PI_SUBAGENT_CHECKS`, a JSON list.

The code for the test run (`changedFiles`, `plan`, `execute`, `verdict`) is in `shared/testrun.ts`, the same as `run_tests` uses.

## What a subagent loads

The command is `pi -ne -ns -np -nc --no-themes -e <path> ... <profile arguments> --session-id ... --session-dir ...`. The flags turn off extension discovery, skills, prompt templates, context files and themes. The profile decides the rest.

- The first `-e` is the subagents extension. It connects the subagent to the supervisor.
- The other `-e` paths come from `subagentExtensions` in `config.json`, in order. Use it for a provider login extension.
- Without `subagentExtensions`, the tool fails. Set `[]` to start with no extra extension.
- The profile `~/.pi/agent/agents/<name>.md` adds its tools, extensions, skills, system prompt and first model. See `PROFILES.md`. The ladder is a later step.

## Plan

The steps are in `TODO.md`, one at a time.

- **Profiles:** `~/.pi/agent/agents/<name>.md` defines all that a subagent gets: models, tools, extensions, skills, MCP, system prompt, extra checks. Repositories hold no profiles. Later, nullspace delivers the same files through its layer kind `agents/`.
- **Done description:** after a green gate, the subagent writes a short done description for the main agent. The format is open.
- **Model ladder:** a profile lists models in order, for example a free model, then IBM, then Haiku, then Sonnet. The tool takes the first available one. Later, quota decide too.
- **Isolation:** window 0 gives each subagent its own worktree or a copy without `.git`, in a jail. The work goes to a merge branch at the end.
- **Retries:** max tries, and an agent reset with a handoff.
- **UI:** last.

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

## Changes

<!-- changelog:start -->
## 0.3.0 — 2026-10-26

- ask and blocker tools, answer action

[All changes](CHANGELOG.md)
<!-- changelog:end -->
