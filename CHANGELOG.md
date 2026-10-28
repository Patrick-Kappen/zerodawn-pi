# Changelog

## 0.20.1 — 2026-10-28

### handoff 0.4.1

- keep the first dirty path whole

### repository

- docs: add tasks for handoff accuracy and the checker note
- ci: make ci-nixos-update.sh executable

## 0.20.0 — 2026-10-28

### shared 0.11.0

- tests: separate unit and integration suites

### bash 0.9.0

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

### checker 0.4.0

- tests: separate unit and integration suites

### core 0.4.0

- tests: separate unit and integration suites

### files 0.6.0

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

### git 0.6.0

- tests: separate unit and integration suites

### handoff 0.4.0

- remove the reused card fixture after tests

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

### pair 0.1.2

- /ide requires PI_PAIR_COMMAND

### projects 0.2.0

- /switch requires PI_PAIR_COMMAND

- mark pi when any window of a folder runs it

- popup picker with open, worktrees and projects scopes

### subagents 0.9.0

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

### tests 0.7.0

- separate unit and integration suites

### repository

- tests: regenerate the pre-commit config after the rebase
- docs: record automatic unit hook timings
- tests: restore automatic unit tests in commit hooks
- docs: record final test separation measurements
- tests: separate unit and integration suites
- tests: clean fixtures and isolate the supervisor environment
- docs: tmux update-environment is the cause of the lost SSH agent
- docs: name the missing SSH_AUTH_SOCK as cause in random failures
- docs: tasks for recall memory, failures, bash, docs flow, test VM
- docs: record status and next steps of the Nixos update PRs
- ci: ask Nixos for an update PR after a package release
- ci: keep renamed test hooks disabled in Nix checks
- ci: select affected checks without repeated test suites

## 0.19.1 — 2026-10-28

### pair 0.1.1

- /ide finds the Neovide window by its nvim socket

### repository

- docs: add astra latency task and guard block measurement
- docs: task to record mistakes and turn frequent ones into fixes

## 0.19.0 — 2026-10-28

### shared 0.10.0

- projects: /switch picker, /ide pair, pi-tui-kit dependency

### ast-grep 0.3.1

- docs: split open work in TODO.md and BACKLOG.md

### bash 0.8.1

- docs: split open work in TODO.md and BACKLOG.md

### checker 0.3.0

- handoff: short warning, tool handoff for an early cut

- check a final answer after a handoff warning

- send back a check that the agent left open

### ctx-manager 0.2.2

- docs: split open work in TODO.md and BACKLOG.md

### files 0.5.1

- docs: split open work in TODO.md and BACKLOG.md

### git 0.5.1

- docs: split open work in TODO.md and BACKLOG.md

### handoff 0.3.0

- short warning, tool handoff for an early cut

- keep the boundary entries of other extensions

- cut in the middle of the work, keep the final answer

### opencode 0.3.1

- docs: split open work in TODO.md and BACKLOG.md

### pair 0.1.0

- First release.

### projects 0.1.0

- First release.

### subagents 0.8.4

- docs: split open work in TODO.md and BACKLOG.md

### systemstate 0.2.1

- docs: split open work in TODO.md and BACKLOG.md

### tests 0.6.2

- docs: split open work in TODO.md and BACKLOG.md

- a check with a pipe reports the failure of any part

### ui 0.2.2

- docs: split open work in TODO.md and BACKLOG.md

### watchdog 0.2.1

- docs: split open work in TODO.md and BACKLOG.md

### repository

- projects: keep the dependencies of pi-tui-kit in its own node_modules
- projects: /switch picker, /ide pair, pi-tui-kit dependency
- docs: record the automatic checks and test quality plan
- docs: split open work in TODO.md and BACKLOG.md
- docs: name the checklist TODO.md
- docs: collect all open points in one checklist with a file per task
- handoff: short warning, tool handoff for an early cut
- handoff: keep the boundary entries of other extensions
- handoff: cut in the middle of the work, keep the final answer
- docs: record accepted NixOS warnings for continued pi work
- ci: record baseline and run behavior contracts
- tests: cover release preparation behavior
- tests: cover checker and background job behavior

## 0.18.0 — 2026-10-27

### checker 0.2.1

- accept a rebuttal, fixed limit per user message

- a step for the user is not an open point

- handoff: cut at the end of a run after the warning

### handoff 0.2.0

- cut at the end of a run after the warning

- resume after a cut, check PR status of the card

### repository

- docs: record the CI and release plan
- checker: accept a rebuttal, fixed limit per user message
- flake: clear the default gitleaks args
- repo: git hooks from tracked .githooks, not from the dev shell
- handoff: cut at the end of a run after the warning
- flake: clear the default gitleaks args
- flake
- handoff: gpt-6-luna first in the default card ladder
- handoff: resume after a cut, check PR status of the card

## 0.17.0 — 2026-10-27

### shared 0.9.0

- a red check shows biome errors without a position

- handoffModels in config.json and the Home Manager module

### checker 0.2.0

- send back an offered step, no notice per follow-up

- also check runs that end on assistant text

- count follow-ups in a row; a tool call resets the count

- shorter follow-up text, no reason for skipped tests

- shorter follow-up text, no reason for skipped tests

### handoff 0.1.0

- First release.

### subagents 0.8.3

- no provider tool choice for the end tools

- the model probe sends a session id for opencode-go

- no start error in a repository without a commit

### tests 0.6.1

- a check with cd runs in the environment of that directory

### ui 0.2.1

- no crash when the terminal is 0 or 1 column wide

### repository

- handoff: short card with state, next actions and PR status
- subagents: no provider tool choice for the end tools
- checker: count follow-ups in a row; a tool call resets the count
- checker: shorter follow-up text, no reason for skipped tests
- checker: shorter follow-up text, no reason for skipped tests
- flake: run the full test suite in a pre-commit hook
- flake: run the full test suite in a pre-commit hook
- handoff: card from a stripped transcript, /handoff to a new session
- shared: handoffModels in config.json and the Home Manager module
- docs: backlog item to restart pi sessions after a rebuild
- docs: open points from the v0.15.0 release session

## 0.16.0 — 2026-10-27

### ast-grep 0.3.0

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

- core: workflow prompt replaces pi rules; tool descriptions complete

### bash 0.8.0

- checker: skip the check while a bash job runs in the background

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

- a reported job stays out of the status note after a restart

- core: workflow prompt replaces pi rules; tool descriptions complete

### checker 0.1.1

- skip the check while a bash job runs in the background

### core 0.3.0

- workflow prompt replaces pi rules; tool descriptions complete

### ctx-manager 0.2.1

- docs: open points of 2026-10-27 in the TODO files

### files 0.5.0

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

- core: workflow prompt replaces pi rules; tool descriptions complete

### git 0.5.0

- core: workflow prompt replaces pi rules; tool descriptions complete

### opencode 0.3.0

- core: each tool rule in one place, description or parameter

- core: workflow prompt replaces pi rules; tool descriptions complete

### subagents 0.8.2

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

### tests 0.6.0

- core: each tool rule in one place, description or parameter

- core: workflow prompt replaces pi rules; tool descriptions complete

### repository

- docs: open points of 2026-10-27 in the TODO files

## 0.15.0 — 2026-10-27

### shared 0.8.0

- outputs as out:<name>; read and grep take it as a path

### bash 0.7.0

- the tool description names the out:<name> reference

- jobs list gives the model only running jobs

- shared: outputs as out:<name>; read and grep take it as a path

### checker 0.1.0

- First release.

### files 0.4.0

- shared: outputs as out:<name>; read and grep take it as a path

- the grep and rg block points to the grep tool

- own grep tool on ripgrep with noIgnore, type and counts

### git 0.4.0

- shared: outputs as out:<name>; read and grep take it as a path

### tests 0.5.0

- shared: outputs as out:<name>; read and grep take it as a path

### repository

- checker: classifier check before the agent settles
- files: own grep tool on ripgrep with noIgnore, type and counts

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
