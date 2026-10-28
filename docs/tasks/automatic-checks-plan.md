# Automatic checks from file changes through CI

Keep feedback close to the change without a manual test checklist for the agent.
Use local unit tests to catch behavior changes before commit and push.
Keep integration tests and complete Nix checks in CI.

This document records the agreed plan, not completed implementation.
The linked tasks have no priority or delivery order.

## Intended checks

| Trigger | Work | Waiting and failure |
|---|---|---|
| Source file changes | Formatting, syntax, LSP diagnostics, affected unit tests | Wait for formatting and a bounded diagnostic period; run tests in the background |
| Commit | Static checks and all affected unit tests for the complete branch change | Block the commit on failure |
| Push | Full unit suite, secrets, branch metadata, paired-repository checks | Block the push on failure |
| PR CI | Static checks, types, unit tests, integration tests, Nix checks, required compatibility checks | Require successful checks before merge |
| Main CI | Full checks and compatibility tests | Report failures; retain logs |

The complete branch change means changes since the branch base, including the proposed commit.
Commit checks must test the staged contents, not unrelated unstaged edits.
Push checks must test each commit tip that the push sends.
No local gate starts integration tests as a substitute for missing unit-test selection.

## Current behavior and limits

The edit and write tools wait for syntax checking and the configured formatter.
The syntax check uses Tree-sitter in clean headless Neovim, not nvimx LSP diagnostics.
Bash file writes do not enter that path. The bash guard blocks file viewers, not all file changes.
Requested checks already support background execution and short error reports.

Public PR #121 and private PR #33 separate test groups and restore automatic unit tests at commit.
They do not implement the watcher or the nvimx connection.
The central push hook currently enables full Nix checks through `zd.flakeCheck=true`.
That check includes integration tests, so it does not match the intended push gate.

## Checks during editing

Observe actual source changes in each active worktree, regardless of which tool writes them.
Include edits, writes, bash scripts, generators, deletions, renames, and background jobs.
Group consecutive changes after a short quiet period.
Keep formatting, file versions, and diagnostic positions consistent.

Let the agent continue while affected unit tests run.
Run one test process per worktree and combine pending changes.
Discard obsolete results and prevent formatter or test output from causing check loops.
Stop watchers and child processes when the session ends.

Use the existing runner, project environment handling, and error reporting where they fit.
Define explicit unit-only commands for automatic selection.
Do not replace absent commands with full checks or integration tests.

## Feedback

Append new failures to the conversation as they arrive.
Show file, line, column when available, and a short error message.
Deduplicate repeated diagnostics and keep full output in a linked log.
Name failed checks without inventing locations when their output contains none.
Keep successful automatic runs silent.
Treat warnings as failures and report setup failures instead of silently skipping checks.

A result applies only to the file contents that produced it.
A newer change invalidates earlier diagnostics and test results.
Missing LSP support or a diagnostic deadline must not appear as a successful LSP check.

## Full Nix checks

In these repositories, `nix flake check` evaluates the flake and builds its declared checks.
Those checks cover static rules, generated hook configuration, types, unit tests, and integration tests.
Nix supplies pinned tools and reuses results when inputs stay unchanged.
Compatibility tests run separately in CI.

A full flake check does not deploy anything or rebuild the user's NixOS system.
It does not prove that the delivered package loads correctly.
The [delivered package test](test-delivered-package.md) covers that separate requirement.
The CI design must avoid repeating suites through recipes, hooks, and Nix checks.

## Test quality

Passing tests do not prove that the required behavior has sufficient protection.
CI must measure coverage across the intended source set, including files that no test imports.
Review must connect required behavior to assertions, not only executed lines.
Bug regressions need evidence that the test fails before the fix and passes afterward.

The baseline records coverage and gaps, but it is not a current completeness gate.
A coverage report cannot prove that all cases work.
Numeric thresholds and allowed exclusions remain owner choices; this plan sets no percentage.

## Linked tasks

- [Detect source changes from every writer](tests-detect-file-changes.md).
- [Connect formatting and nvimx diagnostics](files-nvimx-diagnostics.md).
- [Run affected unit tests automatically](cost-auto-tests-after-edit.md).
- [Deliver short background feedback](tests-background-result.md).
- [Test the complete change before commit](tests-commit-changes.md).
- [Run the full unit suite before push](tests-push-units.md).
- [Separate unit and integration groups](ci-separate-tests.md).
- [Run CI without repeated work](ci-small-pipeline.md).
- [Protect merges with current CI](ci-protect-merges.md).
- [Stop repeated local test runs](local-check-repeats.md).
- [Report coverage across the source set](ci-test-coverage.md).
- [Review protection of required behavior](test-behavior-review.md).
- [Add tests that protect refactors](ci-refactor-tests.md).

## Scope

Apply shared tooling changes through paired PRs in the public and private repositories.
Keep AGENTS.md limited to short project rules.
Put reusable procedures in a skill only when needed; automation must not depend on an agent reading a checklist.
Do not add a dependency, publish a release, change deployment, or change unrelated central hook policy through this plan.
Keep the existing release and NixOS update tasks separate.

Measure formatting delay, diagnostic delay, background test time, and commit and push duration before and after implementation.
Use representative edit batches and changed files; empty hooks alone do not measure normal edit work.

## Source

- Owner discussion in this session: automatic checks after edits, including bash writes.
- Owner discussion: complete changed tests on commit, full unit tests on push, integration tests in CI.
- Owner discussion: full Nix checks and evidence that tests protect required behavior.
- [Test and release plan](../ci-release-plan.md).
- [Recorded baseline](../ci-baseline.md).
