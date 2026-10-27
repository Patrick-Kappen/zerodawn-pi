# Changelog

## 0.14.1 — 2026-10-27

### shared 0.7.1

- tests: run tests and gates in the dev environment of the project

### bash 0.6.1

- inline output also has a 4 KB limit

- print mode waits for background jobs before it ends

- short failure output inline; fail on a missing cwd

### files 0.3.1

- read resends a known part shorter than its note

### subagents 0.8.1

- tests: run tests and gates in the dev environment of the project

- request id in each client request and its answer

- token limit checks the context size, not a sum

### tests 0.4.2

- run tests and gates in the dev environment of the project

- print mode waits for background runs before it ends

### repository

- tests: run tests and gates in the dev environment of the project
- subagents: ladder for now is deepseek on opencode-go, then sonnet low
- docs: subagents design with the decisions of the user
- docs: subagents design with and without nullspace

## 0.14.0 — 2026-10-27

### shared 0.7.0

- subagents: model ladder by availability from subagentModels (breaking)

### subagents 0.8.0

- model ladder by availability from subagentModels (breaking)

### repository

- subagents: opencode-go deepseek after the free one in the ladder
- subagents: model ladder by availability from subagentModels
- ci: nvim in the dev shell for the files compat tests
- docs: TODO note for a done check after every agent

## 0.13.0 — 2026-10-27

### shared 0.6.0

- files: edit and write undo a change that adds a syntax error

### bash 0.6.0

- files: read sends only new lines; bash blocks file views

### files 0.3.0

- edit and write run the formatter of the project

- edit and write undo a change that adds a syntax error

- read sends only new lines; bash blocks file views

### repository

- files: edit and write run the formatter of the project
- files: edit and write undo a change that adds a syntax error
- files: read sends only new lines; bash blocks file views

## 0.12.0 — 2026-10-26

### bash 0.5.1

- a command that moves to the background ends the turn

- end the turn when only jobs are left, not jobs wait

### subagents 0.7.0

- merge action with a merge agent on a conflict

- the subagent commits with its own subject

- a git worktree and branch per subagent

- agent calls done, gate runs, green forces a handoff

- enforced done tool with a git check of the changes

### tests 0.4.1

- bash: a command that moves to the background ends the turn

- bash: end the turn when only jobs are left, not jobs wait

### repository

- subagents: the subagent commits with its own subject
- subagents: a git worktree and branch per subagent
- subagents: agent calls done, gate runs, green forces a handoff
- subagents: enforced done tool with a git check of the changes
- docs: rules for found bugs and for releases
- repo: release notes list repository commits; empty notes fail

## 0.11.0 — 2026-10-26

### shared 0.5.0

- keep diagnostics and warningCount as released

- grouped diagnostics, nix noise, word-only warnings

### bash 0.5.0

- just check-findings shows unhelpful check results

- background true always returns the job id

### tests 0.4.0

- shared: keep diagnostics and warningCount as released

- anomalies file, nixfmt check, results by call number

## 0.10.0 — 2026-10-26

### subagents 0.6.0

- strict ask and blocker, enforced handoff tool

## 0.9.0 — 2026-10-26

### subagents 0.5.0

- read a tmux server that exits during a check as absent
- max 3 gate tries, handoff at 100k tokens

## 0.8.2 — 2026-10-26

### shared 0.4.2

- diagnostics shows a missing command, no echoed option or summary

## 0.8.1 — 2026-10-26

### shared 0.4.1

- tests: short check result: diagnostics only, deduplicated

### tests 0.3.1

- short check result: diagnostics only, deduplicated

## 0.8.0 — 2026-10-26

### shared 0.4.0

- subagents: done gate runs the tests in the subagent

### subagents 0.4.0

- done gate runs the tests in the subagent

### tests 0.3.0

- subagents: done gate runs the tests in the subagent

## 0.7.0 — 2026-10-26

### subagents 0.3.0

- ask and blocker tools, answer action

## 0.6.0 — 2026-10-26

### bash 0.4.0

- guidelines say continue working while a job runs
- guide a wait as one chained command, block a bare sleep
- short messages, no prose in reports

### subagents 0.2.0

- start a subagent from an agent profile
- profile prompt always replaces the pi prompt
- absent profile keys load nothing
- profile extensions resolve in installed packages
- profile skills, MCP and extension lookup
- document the profile proposal and the plan

## 0.5.2 — 2026-10-26

### tests 0.2.2

- no block; replace the bash result, background after 15 s

## 0.5.1 — 2026-10-26

### tests 0.2.1

- an option such as --error-on-warnings is not a warning

## 0.5.0 — 2026-10-26

### shared 0.3.0

- tests: add run_tests tool, block test commands in bash
- subagents: dev sandbox uses the config of the installed package
- subagents: start subagents with nothing but explicit extensions

### ast-grep 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### bash 0.3.0

- background after 15 s, status line result, errors only on failure
- docs: AGENTS.md of each extension as rules, facts to README
- mark a bash variable in a test string for biome

### core 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### ctx-manager 0.2.0

- bash: background after 15 s, status line result, errors only on failure
- docs: AGENTS.md of each extension as rules, facts to README

### files 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### gateway 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### git 0.3.0

- docs: AGENTS.md of each extension as rules, facts to README

### opencode 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### subagents 0.1.0

- First release.

### systemstate 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### tests 0.2.0

- docs: AGENTS.md as short rules for the agent
- run checks in place, a warning is red, recipe contract
- run run_tests in place of a blocked bash test command
- test the registration in index.ts
- add run_tests tool, block test commands in bash

### ui 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

### watchdog 0.2.0

- docs: AGENTS.md of each extension as rules, facts to README

## 0.4.0 — 2026-10-26

### shared 0.2.0

- file ids for codemode tool calls

### bash 0.2.0

- run jobs without a terminal, like CI

### git 0.2.0

- name output files of codemode calls without ENOENT

## 0.3.1 — 2026-10-26

### bash 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

### core 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

### gateway 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

### opencode 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

## 0.3.0 — 2026-10-25

### shared 0.1.0

- First release.

### ast-grep 0.1.0

- First release.

### bash 0.1.0

- First release.

### core 0.1.0

- First release.

### ctx-manager 0.1.0

- First release.

### files 0.1.0

- First release.

### gateway 0.1.0

- First release.

### git 0.1.0

- First release.

### opencode 0.1.0

- First release.

### systemstate 0.1.0

- First release.

### tests 0.1.0

- First release.

### ui 0.1.0

- First release.

### watchdog 0.1.0

- First release.
