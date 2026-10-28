# Detect source changes from every writer

Detect actual file changes instead of relying only on edit and write tool calls.
This is part of the [automatic checks plan](automatic-checks-plan.md).

## Required behavior

- Observe each active worktree separately.
- Include tool edits, bash commands, generators, and background jobs.
- Include new files, deletions, renames, and repeated changes to already dirty files.
- Group consecutive events after a short quiet period.
- Exclude Git metadata, dependencies, logs, temporary files, and generated output that is not source.
- Keep declared source files in scope, including generated source that the project tests.
- Use content versions to distinguish real changes from duplicate events.
- Prevent formatter writes and test output from causing endless runs.
- Reconcile file state after missed events or watcher failures.
- Report watcher failures and stop its resources when the session ends.

The bash guard is not a write barrier.
A shell command parser cannot identify every write from an arbitrary program.

## Evidence

Tests cover edit tools, shell redirects, scripts, generators, and delayed background writes.
Tests cover deletion, rename, rapid changes, duplicate events, and separate worktrees.
An ignored output write starts no test run.
A failed watcher reports its cause instead of marking the worktree checked.

## Source

- Owner discussion: checks must also cover bash edits.
