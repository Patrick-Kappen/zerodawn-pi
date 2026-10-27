# Test and CI baseline

Recorded on 2026-10-27, before changes to test coverage or CI structure.
This record starts [the test and release plan](ci-release-plan.md).
It does not approve a release, deployment, or behavior change.

## Rollback points

Each repository has the local annotated tag `baseline/ci-tests-2026-10-27`.
The tag name does not match a release tag.

| Repository | Commit |
|---|---|
| zerodawn-pi | `a4ce9c9348cdd71a97bea3d5b49ba268ed7c2581` |
| zerodawn-pi-private | `49d75c7e2539402afd04cbdc92a7c697eda6a195` |
| Nixos | `c38471155b81fe5aa2464727cc21b9d4af7d9862` |

The NixOS tag records local main, including its three commits ahead of origin/main at capture time.
A Git revert does not undo a published release or a deployment.

## Results before changes

The measurements use the pinned pi 1.4.0 and Bun 1.4.2 on x86_64-linux.
`run_tests` ran each full suite with Bun coverage enabled through a temporary `bunfig.toml`.
The temporary files were removed before `just check` ran.

| Repository | Tests | Test duration | Line coverage | Function coverage | Full check |
|---|---|---|---|---|---|
| Public pi | 506 pass, 0 fail | 27.5 s | 5,597/6,804 (82.26%) | 917/1,072 (85.54%) | Pass, 26.3 s |
| Private pi | 26 pass, 0 fail | 4.4 s | 144/148 (97.30%) | 32/33 (96.97%) | Pass, 2.8 s |
| NixOS | Nix checks | 23.5 s | Not measured | Not measured | Blocked by two warnings |

Durations include the test or check command and its environment setup. They are single local measurements, not a benchmark.
Coverage includes only files that Bun loaded: 81 public files and four private files.
Unloaded entry points and shell scripts do not enter these percentages.
High coverage does not prove that extensions work together or that a change keeps compatibility.

The NixOS command exits with status zero, but Nix 2.34.9 reports unknown outputs `modules` and `deploy`.
The warning policy makes this result a failure.
These outputs serve supported consumers and must remain.
Resolve support for these outputs in the Nix checker before claiming a baseline without warnings.
Do not remove outputs or filter the warnings to report a passing baseline.

## GitHub settings before changes

All three repositories allow merge commits, squash merges, and rebase merges.
All three disable automatic merging, automatic branch updates, and automatic deletion of merged branches.
No settings changed during this baseline work.

Both pi repositories have no branch protection and no rulesets.
NixOS has no legacy branch protection.
Its active ruleset `22323765` applies to the default branch without bypass actors.
It blocks branch deletion and non-fast-forward updates, and requests Copilot reviews, including draft PRs.
It does not require CI status checks or review on each push.

## Behavior tests and gaps

| Contract | Evidence at baseline | Added protection |
|---|---|---|
| Release preparation | No test calls the release scripts | Real temporary Git repositories check version levels, unchanged components, generated notes, and release validation |
| Rejected release | An empty request changes the package version before returning failure | The failed request must leave files, index, and HEAD unchanged |
| Background jobs and checker | Each extension tests its own event name with a separate mock | Real extension registration and shell jobs check suspension, completion output, failure output, and checker continuation |
| Selection of affected tests | No script contract test | File inputs select the expected suites; extension changes include integration tests |

The empty-release test fails against the baseline script: the version changes from `0.4.0` to `0.4.1` despite exit status 1.
The fix checks for release content before writing any file.
Tests use expected outputs and public events, not private variable values.
The checker receives fixed classifier responses. No test calls a paid provider.

The next test work has concrete gaps, not a target percentage:

- Test publication after an interrupted push or GitHub Release creation. `ci-release.sh` still lacks a test.
- Load the delivered Nix package with the consumer's pinned pi version. Current checks load source files, not the delivered package.
- Test watchdog cancellation and recovery. Its three existing tests cover number parsing, clipping, and entry summaries only.
- Test the handoff warning through the checker. Current tests construct each side separately.

Existing subagent integration tests already start real tmux processes. Keep that coverage instead of adding a second test of the same path.
Private OAuth tests already cover payload hooks, tool names, streaming, and failures. Keep those contracts intact.

## Delivery boundary

The new `integration/` group protects contracts across extensions and release scripts.
It runs through `just test-integration`, the full suite, affected extension tests, and a separate Nix check.
It does not separate all existing unit and integration tests yet.
The existing commit hook still runs the full suite, and CI still repeats some work.
Do not mark the later plan stages complete from this baseline PR.

The pi baseline passes. The NixOS warning blocker prevents completion of the baseline across all three repositories.
Refactoring and release automation remain outside this delivery.

## Local evidence

Coverage reports and settings snapshots are under `~/.local/state/pi-ci-baseline/2026-10-27/`.
The session logs retain the original commands and failures.
The coverage reports use LCOV format. They contain no provider credentials.
