# subagents

The `subagent` tool: the main agent gives a task to a pi agent that runs in tmux. Read `README.md` for the design, `docs/decisions.md` entry 9 for the reasons.

## Need to know

- No shell scripts. All tmux work is TypeScript in `lib/tmux.ts`, through an exec function with an argument list.
- Never use `tmux send-keys` to control an agent. Control goes through the supervisor socket.
- The supervisor (`supervisor.ts`) runs under `process.execPath` of pi: node 24 or bun. Use only `node:` modules and erasable TypeScript (no enum, no namespace, no parameter properties).
- The supervisor owns the subagents. The main pi and the subagents are clients only.
- The same `index.ts` runs in the subagent. `PI_SUBAGENT_SOCKET` and `PI_SUBAGENT_ID` select that mode; setting only one fails. The subagent does not register the tool.
- Small results: the tool result content has only id, status, final text, and one tokens/cost line. Never add events or tool calls to it. Events go to `details`, max 20 entries of 200 characters.
- The supervisor needs `--pi <command>` and `--extension <absolute path>`. The main pi passes `pi`; tests pass `lib/fixtures/fake-pi.mjs`.
- A subagent starts with `-ne -ns -np -nc --no-themes` and loads only `-e` paths: this extension and `subagentExtensions` from `config.json`. Do not add `--no-tools` yet.
- Runtime files go to `/tmp/pi-sub-<id>/` only. Nothing in the project or in `~/.pi`.
- Tests that need tmux use their own server with `tmux -L <socket>`. Never touch the user's tmux server.

## Needs

- `tmux` and `pi` in `PATH`.

## After a pi upgrade

- Make sure `--session-id`, `--session-dir` and `--append-system-prompt` still exist.
- Make sure the event names that the subagent forwards still exist: `tool_execution_start`, `tool_execution_end`, `message_end`, `agent_settled`, and `pi.sendUserMessage`.
- Make sure `-ne -ns -np -nc --no-themes` still exist.
- Make sure `--model anthropic/claude-haiku-5-5:off` and `-e` still work.
