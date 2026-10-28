# Simplify releases to one release PR

Normal work has no version edits. A manual workflow makes one release PR, and merging it publishes.

## Source

- zerodawn-pi main: docs/ci-release-plan.md (stage 6)

## Original text

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
