# Unit and integration test separation

This delivery implements step 2 of [the CI plan](ci-release-plan.md) in both pi repositories.
It keeps extension behavior, versions, release policy, and deployment policy unchanged.

## Groups

Unit tests use isolated logic, mocks, and static fixture reads.
Integration tests change real files or use processes, sockets, Git, tmux, or connections between extensions.
They use `*.integration.test.ts` beside their source, or `*.test.ts` under `integration/`.
Most moves change only filenames. Mixed files remain integration tests; handoff helpers and private configuration tests have separate files for each group.

`just test-unit` runs unit tests. `just test-integration` runs integration tests. `just test` runs both groups.
`run_tests` selects affected unit tests during source edits. Changes to integration tests also select the integration group.
Shared code and root manifest changes select all unit tests. Repository tooling changes select all Nix checks.
`just check` retains lint, types, both test groups, and all Nix checks.

Commit hooks automatically run unit tests and static checks. A unit failure blocks the commit.
CI runs integration tests and complete checks. Agents do not need a manual test checklist.
Local commands remain available to investigate failures.
Nix runs unit tests per extension and for shared code, with Bun as their only test tool.
The integration check keeps the existing process tools. CI still runs both groups through the existing checks.

## Tests for the separation

- Real Bun discovery divides temporary fixtures into disjoint groups, with every test in one group.
- Nested directories, integration filenames, and filenames that contain `integration` without the suffix have explicit expectations.
- Affected source edits select only their unit tests. Shared changes select all unit tests.
- Explicit integration changes select integration tests. A unit failure stops the combined selection with a nonzero exit code.
- Generated commit hooks run unit tests without an agent request and reject unit failures.
- Real hook execution excludes integration files and directories. Nix and CI retain both groups.

The cleanup regression failed before the fix: file, job, and handoff fixtures left temporary directories behind.
Cleanup hooks now remove those directories. The regression checks the fixture directory after a child test process exits.
The child has a separate runtime directory for tools such as Neovim.

The combined Nix run also exposed a supervisor fixture that changed the parent `HOME` and runtime directory.
Later tests resolved shortened paths against the wrong home directory.
Supervisor commands now get a child environment instead. A regression checks that the parent environment stays unchanged.
These fixture fixes form a separate commit before the separation.

## Measurement method

The baseline uses public commit `27fa776` and private commit `4360cef`, with pinned pi 1.4.0 and Bun 1.4.2.
Measurements are single local runs, not a repeated benchmark. Tests and checks in both repositories can overlap.
Tool durations include environment setup. Bun durations cover only the named test group.
Hook measurements use `.githooks/pre-commit` with no staged files, before and after the change.

Before the change, public tests took 29.1 seconds and private tests took 5.6 seconds.
Full checks took 58.3 seconds and 10.3 seconds. Commit hooks took 24.127 seconds and 0.831 seconds.

## Final measurements

The public check includes the rebase onto `8b62f7d`, fixture cleanup, and automatic unit tests in commit hooks.
The private base remains `4360cef`. Both complete checks pass without warnings.

| Measurement | Public before | Public after | Private before | Private after |
|---|---:|---:|---:|---:|
| Full local check, seconds | 58.3 | 57.2 | 10.3 | 6.8 |
| Commit hook, seconds | 24.127 | 0.326 | 0.831 | 0.145 |
| Unit group, Bun seconds | Not separate | 0.191 | Not separate | 0.017 |
| Integration group, Bun seconds | Not separate | 25.98 | Not separate | 0.751 |

The public groups contain 289 unit tests and 230 integration tests. The private groups contain 25 unit tests and 10 integration tests.
Separate `run_tests` runs took 30.8 seconds for the public repository and 5.3 seconds for the private repository, including setup.
The full checks include cached Nix results where available. These times do not measure cold builds.
The hook measurements contain no staged files. They do not measure static checks on changed files.
The hook runs all unit tests automatically, also with no staged files. It does not run integration tests.
The earlier static-only hook took 0.126 seconds publicly and 0.127 seconds privately, but removed the automatic test gate.

## Boundary

This delivery does not change CI scheduling, merge protection, release automation, or NixOS outputs.
Full local checks still repeat tests through direct recipes and Nix. Step 4 addresses that work.
Mixed integration files still contain some isolated assertions. Moving those assertions later does not require a behavior change.
The known NixOS output warnings remain documented in [the baseline](ci-baseline.md).
