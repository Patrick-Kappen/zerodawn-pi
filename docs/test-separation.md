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

Commit hooks retain static checks only. Nix runs unit tests per extension and for shared code, with Bun as their only test tool.
The integration check keeps the existing process tools. CI still runs both groups through the existing checks.

## Tests for the separation

- Real Bun discovery divides temporary fixtures into disjoint groups, with every test in one group.
- Nested directories, integration filenames, and filenames that contain `integration` without the suffix have explicit expectations.
- Affected source edits select only their unit tests. Shared changes select all unit tests.
- Explicit integration changes select integration tests. A unit failure stops the combined selection with a nonzero exit code.
- Generated commit hooks retain static checks and omit test suites. Nix retains both groups.

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

## Boundary

This delivery does not change CI scheduling, merge protection, release automation, or NixOS outputs.
Full local checks still repeat tests through direct recipes and Nix. Step 4 addresses that work.
Mixed integration files still contain some isolated assertions. Moving those assertions later does not require a behavior change.
The known NixOS output warnings remain documented in [the baseline](ci-baseline.md).
