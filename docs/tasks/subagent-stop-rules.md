# Add stop rules for a hung subagent

A hung agent burns tokens. Stop it after a time with no progress or after max turns. Allow max tries and a reset with a handoff.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md
- zerodawn-pi main: extensions/subagents/README.md (Plan: Retries)

## Original text

One step at a time. Each step is its own PR.

10. Stop rules for a hung agent (no progress timeout, max turns).

README: - **Retries:** max tries, and an agent reset with a handoff.
