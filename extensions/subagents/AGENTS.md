# subagents

The `subagent` tool: the main agent gives a task to a pi agent. Each agent runs as a separate pi process in a window of one dedicated tmux session.

Reference: the pi example `examples/extensions/subagent` (single, parallel and chain modes, agents as markdown with frontmatter).

## Design

- The tool does all tmux work in TypeScript (`lib/tmux.ts`), through `pi.exec` without a shell. No shell scripts.
- tmux is the register. No agent writes files to register itself.
- Each main agent gets one detached tmux session `pi-sub-<first 8 characters of its pi session id>`. Each subagent gets one window in that session.
- The tool controls a subagent through the extension, not by typing into its chat (no `tmux send-keys`).

## Requirements

- Each agent runs in the tmux session, so the user can attach and watch it.
- The tool calls of the agent show in the pi UI of the main agent, live.
- A hung agent stops: a timeout on no progress, and a limit on turns. The tool reports which limit stopped it.
- Agents do the task and nothing more: narrow system prompts and narrow tool sets per agent.
- Fixed flows (for example scout, plan, work, review) run as defined steps, not as free choices of the main agent.

## Needs

- `tmux` and `pi` in `PATH`.

## After a pi upgrade

- Make sure the JSON event format of `pi --mode json` did not change.
