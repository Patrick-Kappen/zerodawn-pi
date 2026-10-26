# subagents

Delegate tasks to pi agents. Each agent runs as a normal interactive pi in a window of a detached tmux session.

Status: work in progress. The tool `subagent` has three actions:

- `start` with `profile` and `task`: the supervisor starts a pi agent with that profile in a new window `sub-<first 4 characters of its id>`. The tool waits and returns the final answer.
- `answer` with `id` and `text`: sends `text` to the agent and waits for its next result, like `start`. The agent must have status `idle`, `question` or `blocked`.
- `status`: starts or finds the supervisor, connects, and shows the agents.

The result that the model sees is small: agent id, status, the result text (see "Handoff") and one line with tokens and cost. The last 20 events (200 characters each) go to `details` only.

Every subagent has five fixed tools, whatever its profile says. All have strict schemas (TypeBox); pi validates the arguments and gives the model the error.

- `ask { question }`: `question` max 500 characters. The text goes to the supervisor. The model stops and waits. The result has status `question` and the question as text. The main agent answers with `answer`.
- `blocker { issue, files, tried }`: all required; `issue` not empty; `tried` has at least one entry. The model uses it only after it tried to solve the problem within its task limits. The result has status `blocked`, `details.blocker = {issue, files, tried}` and the short text `issue`, `files: a, b`, `tried: x; y`. The main agent first tries to solve the problem within its own limits, then sends the solution with `answer`.
- `handoff { summary, changes, tests, findings, decisions, open, next, risks }`: the only result of a subagent. The model never chooses it. The extension forces it, see "Flow" and "Handoff".
- `continue {}`: keep working. The model never chooses it; it is active only when the extension forces a choice, see "Flow".
- `done {}`: the task is finished. Always active; the model chooses it. The gate runs next.

pi filters extension tools with `--tools` and `--no-tools`, so the main pi always adds `ask,blocker,handoff,continue,done` to the `--tools` list. The subagent extension removes `handoff` and `continue` from the active tools at `session_start`.

## Flow

1. The agent works. It ends a run with `done` (finished), `ask` or `blocker`.
2. A settle without one of them forces a choice: only `continue`, `done`, `ask`, `blocker` are active, and the provider request forces any tool. The user message is "You stopped. Call continue to keep working, done when the task is finished, ask for a question, or blocker when you cannot go on." `continue` restores the tools and the agent goes on. There is no count; the token limit ends a loop.
3. After `done` the gate runs, see "Done gate". Red: the failures go back to the agent (max 3). Green: the extension forces `handoff`.
4. The 3rd red gate and the token limit force `handoff` too.
5. A valid `handoff` ends the work. The supervisor sends the result to the main agent. Nothing goes to the subagent any more.
6. `answer` from the main agent is a new task. The agent restarts with its normal tools.

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

The gate runs in the subagent, in its extension, on the `agent_settled` that follows a `done` call. It uses the working directory of the subagent.

- A subagent with a pending `ask` or `blocker` skips the gate. Its question or blocker goes to the main agent.
- No changed file (git working tree against HEAD, with untracked files): nothing to test, so the gate is green at once. A scout passes this way.
- A changed code file without a test: red. The subagent gets the file list and must add a test for each.
- The whole repository test set runs (recipe `test`, else `bun test`). Red, or any warning line: the subagent gets only the failures.
- Then each `checks` command of the profile runs in `bash -c`. The first red one goes back with its failures.
- All green: the extension forces the tool `handoff`, see "Handoff".

Red keeps the status `running`. The subagent sends a `gate` event with `green` or `red` and a one-line reason, so the event list shows it. Limits: see "Limits". The main pi sends the `checks` of the profile in the `start` message; the supervisor gives them to the subagent in `PI_SUBAGENT_CHECKS`, a JSON list.

The code for the test run (`changedFiles`, `plan`, `execute`, `verdict`) is in `shared/testrun.ts`, the same as `run_tests` uses.

## Limits

The limits are constants in code. A later step moves them to the profile.

- **Gate tries:** max 3 red gate results per task. On the third, the subagent does not get the failures. It does the forced handoff (see "Handoff") and the result has status `handoff`, `details.reason` with the gate reason, and the line `gate red: <reason>` in the text. An `answer` or a new `task` message resets the count, and so does a green gate.
- **Tokens:** max 100 000 tokens per agent (sum of the usage of its messages). When the sum reaches the limit while the agent runs, the supervisor sends `{type:"handoff"}`. See "Handoff".
- A failed agent is final: a later `settled`, `gate` or `message` event changes nothing.

## Handoff

One schema for every case. All fields are required; an array may be empty.

- `summary`: 1 to 200 characters, one sentence.
- `changes`: `{file, what}` for each changed file.
- `tests`: `{file, covers}` for each test file added or changed.
- `findings`: facts with `path:line`, for a task without changes.
- `decisions`, `open`, `risks`: strings.
- `next`: a string; empty when nothing is open.

Git check at call time: the set of `changes[].file` must equal `changedFiles` (paths relative to the working directory). When no file changed, `changes` is empty and `findings` has at least one entry. An error names both sets. The model tries again; 2 invalid calls fail the agent.

The handoff is forced in the subagent extension; the model cannot skip it. Three cases start it:

- Green gate: no abort (the agent settled already).
- 3rd red gate: no abort.
- Token limit: the supervisor sends `{type:"handoff"}`. `ctx.abort()` stops the run and the extension waits for `agent_settled`, because a prompt during the run fails. An idle agent goes on at once.

Then:

1. `pi.setActiveTools(["handoff"])`: only the tool `handoff` is declared to the model.
2. `pi.sendUserMessage(...)` starts a new run: "The checks are green. Call the tool handoff now.", "The done gate was red 3 times. Call the tool handoff now." or "You reached the token limit. Call the tool handoff now."
3. The `before_provider_request` handler replaces the payload with `forceTool(payload, "handoff")` (`lib/force.ts`). The choice after a stop uses `forceAnyTool(payload, names)` in the same way. The shape comes from the declared tools, not from the model name:
   - a tool with `name` and `input_schema` is the Anthropic messages API: `tool_choice: {type:"tool", name}`, or `{type:"any"}` for any tool. An enabled `thinking` field is removed, because Anthropic rejects it with a forced tool.
   - a tool `{type:"function", function:{name}}` is OpenAI chat completions: `tool_choice: {type:"function", function:{name}}`, or `"required"`.
   - a tool `{type:"function", name}` without `function` is OpenAI responses: `tool_choice: {type:"function", name}`, or `"required"`.
   - Else the subagent sends an error event "<tool>: cannot force a tool for this provider payload: <keys>" and the supervisor fails the agent.
4. The tool sends `{type:"handoff", data, gate?, reason?}` to the supervisor and returns "Handoff sent. Stop.". Nothing more goes to the agent.

An agent that settles during a forced handoff or choice without a call fails.

The supervisor sends the result to the main agent:

- Status `idle` for a green gate; `handoff` for the token limit and for 3 red gates.
- Text: the summary, one line `file: what` for each change, one line for each finding, `tests: <gate line>; added: a, b` (green) or `gate red: <reason>`, then `decisions:`, `open:`, `next:`, `risks:` only when not empty.
- `details.handoff` has the model data; `details.gate` (files, tests line) or `details.reason` has the gate data.

## What a subagent loads

The command is `pi -ne -ns -np -nc --no-themes -e <path> ... <profile arguments> --session-id ... --session-dir ...`. The flags turn off extension discovery, skills, prompt templates, context files and themes. The profile decides the rest.

- The first `-e` is the subagents extension. It connects the subagent to the supervisor.
- The other `-e` paths come from `subagentExtensions` in `config.json`, in order. Use it for a provider login extension.
- Without `subagentExtensions`, the tool fails. Set `[]` to start with no extra extension.
- The profile `~/.pi/agent/agents/<name>.md` adds its tools, extensions, skills, system prompt and first model. See `PROFILES.md`. The ladder is a later step.

## Plan

The steps are in `TODO.md`, one at a time.

- **Profiles:** `~/.pi/agent/agents/<name>.md` defines all that a subagent gets: models, tools, extensions, skills, MCP, system prompt, extra checks. Repositories hold no profiles. Later, nullspace delivers the same files through its layer kind `agents/`.
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
## 0.6.0 — 2026-10-26

- strict ask and blocker, enforced handoff tool

[All changes](CHANGELOG.md)
<!-- changelog:end -->
