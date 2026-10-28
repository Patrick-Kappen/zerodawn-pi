# Plan: tests, CI, and releases

## Goal and scope

Establish a tested baseline before refactoring. Keep local work fast, require stronger CI checks, and gather changes before release.

Keep the existing test tools, component versions, and merge method. Do not add a test framework, orchestration service, or custom commit-hash protocol.

Keep extension behaviour unchanged during this work. This plan does not authorize a release or deployment.

## Baseline record

[The baseline](ci-baseline.md) records measurements, rollback points, merge settings, and missing behavior tests.
The first delivery adds contract tests and fixes mutation during an empty release request.
The owner accepts the known NixOS output warnings for continued pi work, not as successful checks.
Later stages remain open; this delivery does not authorize refactoring or publication.

## 1. Record the baseline

- Create rollback tags in both pi repositories and the NixOS repository. Use names outside the release tag patterns.
- Record current GitHub merge settings without secret values.
- Run the current checks.
- Record test results, coverage, and duration.

Coverage identifies gaps. It does not prove that behaviour stays correct.

Done when: the current code passes, and the baseline identifies tested behaviour and gaps.

## 2. Separate unit and integration tests

The [separation record](test-separation.md) describes the test groups, checks, measurements, and delivery boundary.

Unit tests cover isolated logic, such as parsing, formatting, test selection, and release calculation.

- Run unit tests automatically from commit hooks, with static checks.
- Run integration tests and complete checks in CI, without an agent checklist.
- Keep `run_tests` and `just check` available to investigate failures locally.

Integration tests cover processes, files, sockets, tmux, Git, and connections between extensions.

- Put existing integration tests in an explicit group.
- Keep working tests intact where possible.
- Update agent rules and recipes to match the test groups.

Done when: unit tests run without external services, tmux sessions, or agent processes.

## 3. Add tests that protect refactors

- Test bash commands, background results, cancellation, and cleanup.
- Test command routing between the tests and bash extensions.
- Test checker and handoff behaviour while jobs remain active.
- Test watchdog cancellation and recovery.
- Test subagent start, result delivery, failure, and cleanup.
- Test loading the built package with the pinned pi version.
- Test configuration loading and useful errors.
- Test release calculation, documentation-only changes, multiple components, empty requests, repeated execution, and interrupted publication.

Use fixed model responses. Keep paid provider calls outside required CI. Test observable behaviour, not private implementation details.

Done when: regression tests cover the main extension connections and release failure paths.

## 4. Use a small CI pipeline

| Stage | Work |
|---|---|
| Static checks | Formatting, lint, types, secrets, commit metadata |
| Unit tests | Full unit suite |
| Integration tests | Processes, extension interactions, compatibility |
| Package checks | Nix build and loading the delivered package |

Run static checks and unit tests in parallel. Run integration and package checks after they pass.

- Run each suite once, without overlapping recipes.
- Use existing Nix caching.
- Set job timeouts.
- Cancel obsolete PR runs, but not publication midway.
- Retain failure logs.
- Treat warnings as failures.
- Add scheduled lifecycle repetitions after the required tests are stable.

Done when: CI gives clear failures without repeating the same work.

## 5. Protect merges

- Require CI before merge.
- Require checks against the current base.
- Keep the current merge method.
- Delete merged branches automatically.
- Check shared tooling consistency in CI.
- Apply shared tooling changes through paired PRs in both pi repositories.

Done when: failed or outdated checks block merging.

## 6. Simplify releases

1. Merge normal work without version or changelog edits.
2. Run a manual release workflow when a deliverable is ready.
3. Create or update one release PR.
4. Calculate versions and generate grouped notes automatically.
5. Review and merge the release PR.
6. Publish tags and the GitHub Release automatically.

Documentation, tests, and CI changes alone do not require a release. Packaging and dependency changes count when they change the delivered package.

Keep changelogs as the source. Replace copied README notes with links. Keep component versions and the current semantic version rules.

Make publication safe to retry. Prevent concurrent publication. Do not add another release framework.

Done when: one approved release PR produces one complete release without manual repair.

## 7. Create NixOS update PRs

Add a scheduled and manually runnable workflow in `Patrick-Kappen/Nixos`.

- Select published pi releases, not unreleased changes.
- Update the relevant inputs and lock entries.
- Create or update one PR.
- Run Nix checks and build affected configurations.
- Test against the pi version selected by the consumer inputs.
- Keep merge and deployment approval manual.

Use a narrowly scoped GitHub App so bot-created PRs receive normal CI checks. App installation and credentials need owner setup.

Done when: a published release reaches NixOS through a tested PR, without automatic deployment.

## Delivery and rollback

Use small, linked PRs in this order:

1. Baseline and test separation.
2. Missing regression and integration tests.
3. CI and merge protection.
4. Release automation.
5. NixOS updates.

Deliver the work as one coordinated change, not one atomic merge across repositories. Activate publication and downstream automation last.

Rollback uses normal revert commits, saved GitHub settings, and the previous NixOS generation. A Git revert does not undo published releases or external actions.

Test release automation in temporary repositories before activation. Do not publish production releases during validation.

Refactoring starts only after the required checks pass and the release flow passes a dry run.
