# opencode

## Tool

`opencode` — `task`, `model`, `session`.

Gives one task to an [OpenCode](https://opencode.ai) agent in the same project and returns its short report. The agent can read, edit, search and run tests; it cannot commit, push or delete files. `session` continues an earlier agent. A model id that OpenCode does not know returns the list of models.

Needs `opencode` in `PATH`. No config. Tests: `events.test.ts`.

## Changes

<!-- changelog:start -->
## 0.1.1 — 2026-10-26

- deps: take pi and its packages from llm-agents, not from npm

[All changes](CHANGELOG.md)
<!-- changelog:end -->
