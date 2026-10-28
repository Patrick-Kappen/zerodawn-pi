# Changelog

## 0.6.2 — 2026-10-28

- docs: split open work in TODO.md and BACKLOG.md

- a check with a pipe reports the failure of any part

## 0.6.1 — 2026-10-27

- a check with cd runs in the environment of that directory

## 0.6.0 — 2026-10-27

- core: each tool rule in one place, description or parameter

- core: workflow prompt replaces pi rules; tool descriptions complete

## 0.5.0 — 2026-10-27

- shared: outputs as out:<name>; read and grep take it as a path

## 0.4.2 — 2026-10-27

- run tests and gates in the dev environment of the project

- print mode waits for background runs before it ends

## 0.4.1 — 2026-10-26

- bash: a command that moves to the background ends the turn

- bash: end the turn when only jobs are left, not jobs wait

## 0.4.0 — 2026-10-26

- shared: keep diagnostics and warningCount as released

- anomalies file, nixfmt check, results by call number

## 0.3.1 — 2026-10-26

- short check result: diagnostics only, deduplicated

## 0.3.0 — 2026-10-26

- subagents: done gate runs the tests in the subagent

## 0.2.2 — 2026-10-26

- no block; replace the bash result, background after 15 s

## 0.2.1 — 2026-10-26

- an option such as --error-on-warnings is not a warning

## 0.2.0 — 2026-10-26

- docs: AGENTS.md as short rules for the agent
- run checks in place, a warning is red, recipe contract
- run run_tests in place of a blocked bash test command
- test the registration in index.ts
- add run_tests tool, block test commands in bash

## 0.1.0 — 2026-10-25

- First release.
