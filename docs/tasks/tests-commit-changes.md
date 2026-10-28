# Test the complete change before commit

Run affected unit tests for the complete proposed branch change, not only its last edit.
This is part of the [automatic checks plan](automatic-checks-plan.md).

## Required behavior

- Determine the branch base explicitly.
- Include committed branch changes and the staged changes in the proposed commit.
- Test the exact staged contents without unrelated unstaged edits.
- Preserve the working tree and index on success, failure, or interruption.
- Include new, deleted, and renamed files in selection.
- Use a declared unit-only selection command.
- Select all units when shared changes require them.
- Retain static checks and commit-message validation.
- Block the commit on test failure, warnings, or an unavailable required check.
- Do not start integration tests or full Nix checks.

An earlier background success is not proof for different staged contents.
A missing branch base or unit command needs an explicit error and next step.

## Evidence

Tests cover multiple commits since the base, staged-only changes, partial staging, renames, and deletions.
A failure blocks the commit and leaves the user's files and index unchanged.
Integration fixtures that fail if loaded remain untouched.
Tests confirm that an earlier passing background run cannot hide a new staged failure.

## Source

- Owner discussion: run the full changed test set on commit.
