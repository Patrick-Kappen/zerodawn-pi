# Improvements

- UI: move the tool call view to `shared/`, so every extension uses it. It must show better what a tool call does.
- Research: how to run everything in the background, without trouble for the agent or the user.
- Tests: subagents (they load only `subagentExtensions`) and `opencode` run test and check commands without the `tests` extension, with the full output.


- Have a done check after every agent.

- New extension `handoff` (design from 2026-10-27):
  - A light background agent (free model, else luna-6 low) gets a stripped transcript (user and assistant text, tool calls as one line, no tool output) and one tool `write_card` with a hard JSON schema: goal, status, decisions, open, next, avoid, done (one line per PR or commit; done items drop out).
  - Code adds the system facts: open PRs, branch, worktrees, running jobs, dirty files.
  - Decider in code: task done gives a handoff. Cache expired, context under 100k and something runs: keep warm, max 30 min. Over 100k at a cache break, or about 150k in an active session: handoff. Mid-task: first tell the agent to finish the step.
  - Handoff as a compaction in the same session or as a new session (`newSession` with `parentSession`).
- `recall`: one question about an old session; a cheap model searches its stripped transcript and returns a short answer with entry ids. Later maybe long-term memory.
- Measure again a few days after the merges of 2026-10-27: cost per call, full cache rewrites, cache_warm entries, calls per tool. Then hide unused tools (codemode still finds them) or add a skill for a tool that is used wrong.
- Pi bug: `sdk.js` keeps cache warming only while each message object stays the same, and `buildSessionProjection` builds new objects for custom messages, context edits and compaction summaries. Nixos#382 patches it. Report it upstream; remove the patch when pi fixes it.
- `~/.pi/agent/settings.json` lists both packages twice: once with a filter, once without. Clean it up.
