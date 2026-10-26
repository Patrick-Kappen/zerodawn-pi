# subagents

The `subagent` tool: the main agent gives a task to a pi agent that runs in tmux. Read `README.md` for the design and the plan, `PROFILES.md` for the profile format, `docs/decisions.md` entry 9 for the reasons.

## Rules

- No shell scripts. All tmux work is TypeScript in `lib/tmux.ts`, through an exec function with an argument list.
- Never use `tmux send-keys` to control an agent. Control goes through the supervisor socket.
- The supervisor (`supervisor.ts`) runs under `process.execPath` of pi: node 24 or bun. Use only `node:` modules and erasable TypeScript (no enum, no namespace, no parameter properties).
- The supervisor owns the subagents. The main pi and the subagents are clients only.
- The same `index.ts` runs in the subagent. `PI_SUBAGENT_SOCKET` and `PI_SUBAGENT_ID` select that mode; setting only one fails. The subagent does not register the tool.
- Small results: the tool result content has only id, status, final text, and one tokens/cost line. Never add events or tool calls to it. Events go to `details`, max 20 entries of 200 characters.
- Every subagent has the tools `ask`, `blocker` and `handoff`, whatever the profile says. `lib/resolve.ts` always puts them in `--tools`, because pi filters extension tools with `--tools`. Never pass `--no-tools`.
- The interaction tools have strict schemas in `lib/schemas.ts`: `ask` max 500 characters; `blocker` and `handoff` with required fields. Change a schema together with `lib/protocol.ts`, `lib/format.ts` and the tests.
- The model never chooses `handoff`. It is inactive until the supervisor asks. Then the subagent extension does `ctx.abort()`, `pi.setActiveTools(["handoff"])`, a user message, and a forced tool choice in `before_provider_request` (`lib/force.ts`). An unknown payload shape fails loud. Add a shape with a test.
- Limits: the done gate, max 3 gate tries (the 3rd red gate ends in a handoff) and the 100k token limit exist. Do not remove or bypass them.
- Tests pass a wrapper of `lib/fixtures/fake-pi.ts` as `--pi`. Never start a real pi in a test.
- A subagent starts with `-ne -ns -np -nc --no-themes` and loads only `-e` paths: this extension and `subagentExtensions` from `config.json`. The profile arguments follow: the main pi reads and resolves the profile (it has HOME), and the supervisor only gets `args` in the `start` message.
- Runtime files go to `/tmp/pi-sub-<id>/` only. Nothing in the project or in `~/.pi`.
- Tests that need tmux use their own server with `tmux -L <socket>`. Never touch the user's tmux server.

## After a pi upgrade

- Make sure `--session-id`, `--session-dir` and `--append-system-prompt` still exist.
- Make sure the event names that the subagent forwards still exist: `tool_execution_start`, `tool_execution_end`, `message_end`, `agent_settled`, and `pi.sendUserMessage`.
- Make sure `-ne -ns -np -nc --no-themes` still exist.
- Make sure `ctx.abort()`, `pi.setActiveTools()` and the replacement of the payload in `before_provider_request` still work, and that the payload shapes in `lib/force.ts` are still the shapes of the providers.
- Make sure `--model`, `--tools`, `--no-tools`, `--no-mcp`, `--skill`, `--system-prompt` and `-e` still work, and that `-e builtin:<name>` loads a builtin extension.
