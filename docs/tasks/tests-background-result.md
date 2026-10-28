# Run tests in the background with short results

Report automatic failures as new conversation messages without making the agent wait.
Use the [automatic checks plan](automatic-checks-plan.md) for the complete flow.

## Required behavior

- Append current failures to history when they arrive.
- Let the agent receive failures during a run or after it settles.
- Show file, line, column when available, and the short error text.
- Deduplicate repeated lines and repeated reports for unchanged failures.
- Keep full output in a log and include its reference.
- Name the failed check when no source location exists.
- Discard reports for obsolete file versions.
- Keep successful automatic runs silent.
- Keep an explicit short result for a test command that the agent or user requests.
- Report warnings, timeouts, missing commands, and failed environments as failures.
- Keep result delivery safe in interactive, print, and JSON modes.
- Prevent a failure message from starting the same check repeatedly.

## Evidence

Tests cover duplicate diagnostics, multiple locations, absent locations, and stale results.
Tests cover an agent that is busy, idle, or about to exit print mode.
A successful automatic run adds no conversation entry.
A failed automatic run adds a short message without full output or a repeated notification loop.

## Source

- Owner discussion: append concise, deduplicated failures and keep automatic success silent.
- zerodawn-pi main: extensions/tests/TODO.md

## Original text

The original note includes a green result; requested runs keep that result, while automatic success stays silent.

- Agent should only test when really necesary, run in background completly.
- Get's errors or a green sign.
- Combines with bash / ui
