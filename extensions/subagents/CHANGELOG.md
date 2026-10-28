# Changelog

## 0.10.0 — 2026-10-28

- start and answer return the id; a message gives the result (breaking)

## 0.9.0 — 2026-10-28

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

## 0.8.4 — 2026-10-28

- docs: split open work in TODO.md and BACKLOG.md

## 0.8.3 — 2026-10-27

- no provider tool choice for the end tools

- the model probe sends a session id for opencode-go

- no start error in a repository without a commit

## 0.8.2 — 2026-10-27

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

## 0.8.1 — 2026-10-27

- tests: run tests and gates in the dev environment of the project

- request id in each client request and its answer

- token limit checks the context size, not a sum

## 0.8.0 — 2026-10-27

- model ladder by availability from subagentModels (breaking)

## 0.7.0 — 2026-10-26

- merge action with a merge agent on a conflict

- the subagent commits with its own subject

- a git worktree and branch per subagent

- agent calls done, gate runs, green forces a handoff

- enforced done tool with a git check of the changes

## 0.6.0 — 2026-10-26

- strict ask and blocker, enforced handoff tool

## 0.5.0 — 2026-10-26

- read a tmux server that exits during a check as absent
- max 3 gate tries, handoff at 100k tokens

## 0.4.0 — 2026-10-26

- done gate runs the tests in the subagent

## 0.3.0 — 2026-10-26

- ask and blocker tools, answer action

## 0.2.0 — 2026-10-26

- start a subagent from an agent profile
- profile prompt always replaces the pi prompt
- absent profile keys load nothing
- profile extensions resolve in installed packages
- profile skills, MCP and extension lookup
- document the profile proposal and the plan

## 0.1.0 — 2026-10-26

- First release.
