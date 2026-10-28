# Report coverage across the intended source set

Use CI to expose untested code and coverage decreases.
Do not treat a passing suite or a high percentage as proof of complete behavior tests.
This is part of the [automatic checks plan](automatic-checks-plan.md).

## Required behavior

- Define the source set and explain exclusions.
- Include source files that no test imports.
- Report line and function coverage with the existing tools.
- Inspect support before promising branch coverage.
- Compare PR results with the current base.
- Retain reports and identify uncovered changes.
- Separate units and integrations without double-counting combined results.
- Keep coverage collection out of automatic edit checks.
- Fail clearly when the coverage report is missing or invalid.

The recorded baseline includes only files Bun loaded.
Its public line coverage is 82.26%; private line coverage is 97.30%.
Those measurements are historical and do not describe current coverage.

The owner must choose numeric thresholds and permitted exclusions before CI enforces them.
Do not silently adopt a 100% target or accept the historical percentages as complete coverage.

## Evidence

An unimported source file appears as uncovered.
A PR that removes test coverage produces a visible decrease.
Missing reports do not pass the coverage check.
Fixtures demonstrate that a high execution percentage can coexist with a missing behavior assertion.

## Source

- Owner discussion: determine whether tests cover most cases.
- [Recorded baseline](../ci-baseline.md).
