# Review protection of required behavior

Connect required behavior to assertions and observable results.
Coverage measures execution, not the quality of those assertions.
This is part of the [automatic checks plan](automatic-checks-plan.md).

## Required behavior

- Identify the behavior that each change must preserve or add.
- Record tests for normal inputs, boundaries, invalid inputs, and failures where applicable.
- Cover cancellation, cleanup, retries, and component connections where applicable.
- Test observable outcomes, not only mocks or internal implementation.
- Demonstrate that each bug regression fails before its fix and passes afterward.
- Record missing cases in the existing task system without treating them as covered.
- Keep paid provider calls outside required tests.
- Use CI for reports and PR review for the behavior assessment.
- Do not require a long manual checklist after each agent edit.

Keep repeatable review procedures in a skill when needed.
Keep AGENTS.md limited to project-specific rules.
No report can prove that every possible case works.

## Evidence

A review can map each stated requirement to a test and its expected result.
A deliberately wrong result fails the relevant test.
Error paths include assertions about remaining files, processes, and state where applicable.
Missing component tests remain visible even when unit coverage is high.

## Related work

- [Tests that protect refactors](ci-refactor-tests.md).
- [Coverage reports](ci-test-coverage.md).

## Source

- Owner discussion: test completeness, covered cases, and coverage limits.
