# CI selection and test value

CI selects checks from changed files on PRs and pushes to main.
PRs compare against the merge base. Main compares against the commit before the whole push.
Deleted paths remain in the selection, including files renamed into documentation.

## Selection

Every run keeps formatting, lint, and safety checks through `pre-commit`.
That Nix check skips the local `tests` hook. Local commits still run the hook.

| Changed input | Additional checks |
|---|---|
| Known documentation | None |
| One extension | Its tests, integration tests, and TypeScript types |
| Several extensions | Each affected extension, integration tests once, and types |
| Integration tests | Integration tests and types |
| Shared code, root manifest, Nix inputs | Every Nix check and released-extension compatibility |
| Scripts, workflow, other configuration, unknown paths | Every Nix check |
| Removed extension | Every Nix check |
| Only versions and release notes | Release validation, without behavior tests |

Known documentation includes Markdown under `docs/`, the listed root guides, and direct extension or shared guides.
Markdown fixtures inside an extension still select its tests.
A dependency change beside a version field is not a version-only change.
A missing base commit, invalid manifest, or failed check stops CI with an error.

Each extension check runs only that extension's tests.
`tests-shared` runs shared tests once. `tests-integration` runs the cross-extension and release contracts once.
Compatibility checks remain separate: they test released code against current shared code and dependencies.

## Before and after

The public documentation PR #124 selected every Nix check.
Its [CI log](https://github.com/Patrick-Kappen/zerodawn-pi/actions/runs/40653502289) also records the full suite inside `pre-commit`.
The new selection tests exercise documentation, source, fixtures, manifests, renames, deletions, and failed tools in temporary Git repositories.
They record the selected Nix commands without running Nix inside the test.

For the current public layout, without cached results:

| Input | Test commands before | Test commands after |
|---|---|---|
| Markdown under `docs/` | 20 | 0 |
| One extension | 3 | 2 |
| Shared source | 20 | 19 |

The shared-source count hides the largest repetition.
Previously, shared tests ran inside all 17 extension checks, their own check, and the full-suite hook: 19 copies.
Now they run once. No existing test is removed.
These counts describe selected work, not elapsed time. Downloads and cached results affect CI duration.

## Are all tests necessary?

A focused review found useful behavior coverage, not a reason to remove whole suites.
Release tests check that rejected changes leave files, the index, and HEAD unchanged.
Background-job tests check the connection between bash and the checker.
Subagent tests exercise actual tmux processes and supervisor behavior.
Separate mocks cannot replace these contracts.

A few assertions repeat shared functions through re-exports. Removing them saves little compared with removing repeated suite execution.
This review does not prove that every assertion is necessary. It does not measure flakiness or mutation coverage.
The separate unit and integration work remains in public PR #121 and private PR #33.
This change does not alter local test selection or the local `just check` sequence.
