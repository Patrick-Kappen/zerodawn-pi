# Allow a small docs change without a PR

A small change to docs, for example a task note, does not need a worktree, a PR and the full test suite. Let it go to `main` directly.

## Source

- User, 2026-10-29

## Original text

- We do not need a PR for a doc change this small.

## To do

- Define "small docs change": only files under `docs/`, no README, no CHANGELOG, no code.
- Change the rule in `AGENTS.md` ("Work in a worktree ... Open a PR") for that case.
- Make the pre-commit hook skip the full test suite when only such files change.
- Decide if the `Change:` trailer is still necessary for these commits.
