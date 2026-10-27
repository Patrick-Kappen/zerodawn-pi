# Changelog

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
