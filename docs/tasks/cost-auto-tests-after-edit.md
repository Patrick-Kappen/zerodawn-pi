# Run tests automatically after edits

Run affected unit tests automatically after source changes, without an agent request.
Use the [automatic checks plan](automatic-checks-plan.md) for the complete flow.

## Required behavior

- Accept versioned changes from the [file observer](tests-detect-file-changes.md), not only edit tool events.
- Wait for formatting and coordinate with the [nvimx diagnostic connection](files-nvimx-diagnostics.md).
- Group consecutive changes after a short quiet period.
- Use an explicit project command that selects only affected unit tests.
- Select all units for shared changes when required.
- Report a missing command or selection failure instead of running integrations as a substitute.
- Use the existing project environment handling.
- Keep one active test process per worktree and combine pending changes.
- Cancel or supersede obsolete work without publishing stale results.
- Let the agent continue while tests run.
- Send failures through the [background feedback path](tests-background-result.md).
- Keep successful automatic runs silent.
- Stop child processes and pending work when the session ends.

Requested test commands remain available for investigation.
Commit and push gates remain independent checks of the exact contents they protect.

## Evidence

Tests cover rapid changes, a slow test run, a newer edit during a run, and separate worktrees.
An automatic run selects units only and does not block the next agent request.
A stale failure does not appear after a newer file version replaces it.
Environment failures reach the agent with the file or check and the next step.
Measure test selection time and edit-to-feedback time before and after the change.

## Source

- Owner discussion: automatic checks after every source change, including bash writes.
- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

The original note includes a green result; the agreed automatic flow keeps success silent.

- Tests: 114 of 137 sessions with edits never ran `run_tests` (1878 edits, 169 runs). Run the tests automatically after edits, in the background, and report errors or one green line. Later LSP diagnostics.
