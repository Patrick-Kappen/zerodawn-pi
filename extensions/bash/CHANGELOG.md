# Changelog

## 0.12.0 — 2026-10-28

- let the agent start a job at once with background

## 0.11.0 — 2026-10-28

- wait inline for a call alone in its message

## 0.10.0 — 2026-10-28

- run long commands and tests in the background at once (breaking)

## 0.9.0 — 2026-10-28

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

## 0.8.1 — 2026-10-28

- docs: split open work in TODO.md and BACKLOG.md

## 0.8.0 — 2026-10-27

- checker: skip the check while a bash job runs in the background

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

- a reported job stays out of the status note after a restart

- core: workflow prompt replaces pi rules; tool descriptions complete

## 0.7.0 — 2026-10-27

- the tool description names the out:<name> reference

- jobs list gives the model only running jobs

- shared: outputs as out:<name>; read and grep take it as a path

## 0.6.1 — 2026-10-27

- inline output also has a 4 KB limit

- print mode waits for background jobs before it ends

- short failure output inline; fail on a missing cwd

## 0.6.0 — 2026-10-27

- files: read sends only new lines; bash blocks file views

## 0.5.1 — 2026-10-26

- a command that moves to the background ends the turn

- end the turn when only jobs are left, not jobs wait

## 0.5.0 — 2026-10-26

- just check-findings shows unhelpful check results

- background true always returns the job id

## 0.4.0 — 2026-10-26

- guidelines say continue working while a job runs
- guide a wait as one chained command, block a bare sleep
- short messages, no prose in reports

## 0.3.0 — 2026-10-26

- background after 15 s, status line result, errors only on failure
- docs: AGENTS.md of each extension as rules, facts to README
- mark a bash variable in a test string for biome

## 0.2.0 — 2026-10-26

- run jobs without a terminal, like CI

## 0.1.1 — 2026-10-26

- deps: take pi and its packages from llm-agents, not from npm

## 0.1.0 — 2026-10-25

- First release.
