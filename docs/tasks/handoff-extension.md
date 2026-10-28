# Build the handoff extension (card writer, system facts, decider)

Long sessions cost much because each call sends the full context. A handoff writes a short card and starts with a small context. A cheap model writes the card, code adds the system facts, and code decides when to do the handoff.

## Source

- zerodawn-pi main: TODO.md

## Original text

- New extension `handoff` (design from 2026-10-27):
  - A light background agent (free model, else luna-6 low) gets a stripped transcript (user and assistant text, tool calls as one line, no tool output) and one tool `write_card` with a hard JSON schema: goal, status, decisions, open, next, avoid, done (one line per PR or commit; done items drop out).
  - Code adds the system facts: open PRs, branch, worktrees, running jobs, dirty files.
  - Decider in code: task done gives a handoff. Cache expired, context under 100k and something runs: keep warm, max 30 min. Over 100k at a cache break, or about 150k in an active session: handoff. Mid-task: first tell the agent to finish the step.
  - Handoff as a compaction in the same session or as a new session (`newSession` with `parentSession`).
