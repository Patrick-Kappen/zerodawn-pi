# opencode

## Tool

`opencode` — `task`, `model`, `session`.

Gives one task to an [OpenCode](https://opencode.ai) agent in the same project and returns at once. An `opencode` message gives its short report and starts a turn. The end of the session stops a running agent. The agent can read, edit, search and run tests; it cannot commit, push or delete files. `session` continues an earlier agent. A model id that OpenCode does not know returns the list of models.

Needs `opencode` in `PATH`. No config. Tests: `events.test.ts`.

## Changes

<!-- changelog:start -->
## 0.4.0 — 2026-10-28

- show the error event before the exit code

- return at once; a message gives the report (breaking)

[All changes](CHANGELOG.md)
<!-- changelog:end -->
