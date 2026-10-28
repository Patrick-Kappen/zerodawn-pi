# Add tests that protect refactors

Before a refactor, tests must cover the main extension links and release failure paths, with fixed model answers.

## Source

- zerodawn-pi main: docs/ci-release-plan.md (stage 3)

## Original text

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
