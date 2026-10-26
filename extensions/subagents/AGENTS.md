# subagents

The `subagent` tool: the main agent gives a task to a pi agent that runs in tmux. Read `README.md` for the design, `docs/decisions.md` entry 9 for the reasons.

## Need to know

- No shell scripts. All tmux work is TypeScript in `lib/tmux.ts`, through an exec function with an argument list.
- Never use `tmux send-keys` to control an agent. Control goes through the supervisor socket.
- The supervisor (`supervisor.ts`) runs under `process.execPath` of pi: node 24 or bun. Use only `node:` modules and erasable TypeScript (no enum, no namespace, no parameter properties).
- The supervisor owns the subagents. The main pi and the subagents are clients only.
- Runtime files go to `/tmp/pi-sub-<id>/` only. Nothing in the project or in `~/.pi`.
- Tests that need tmux use their own server with `tmux -L <socket>`. Never touch the user's tmux server.

## Needs

- `tmux` and `pi` in `PATH`.

## After a pi upgrade

- Make sure `--session-id`, `--session-dir` and `--append-system-prompt` still exist.
- Make sure the event names that the subagent forwards still exist.
