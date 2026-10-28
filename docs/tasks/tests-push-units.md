# Run the full unit suite before push

Run all unit tests before push and leave integration tests to CI.
This is part of the [automatic checks plan](automatic-checks-plan.md).

## Required behavior

- Test the exact commit tip for each pushed ref that needs checks.
- Do not use dirty working files as proof for the pushed commit.
- Keep secret scanning, branch-message checks, and shared-tooling consistency checks.
- Block the push on unit failure, warnings, or unavailable required checks.
- Replace the full Nix check at push for these repositories with the unit gate.
- Keep unrelated repositories' central hook policy unchanged.
- Record the policy in the repository or its managed configuration, not an undocumented local override.
- Do not start integration tests at push.

The central hook currently reads `zd.flakeCheck=true` and runs `nix flake check`.
Its full check includes integration tests.
Changing only the repository hook does not remove that earlier central check.

## Evidence

Tests cover dirty working files, multiple pushed refs, deletion-only pushes, and failed unit tests.
Secret scanning and paired-repository checks still reject invalid pushes.
Integration fixtures that fail if loaded remain untouched.
Measure the push gate with cached and changed inputs.

## Source

- Owner discussion: full unit tests on push, integration tests in CI.
- Inspected central hook: `zd.flakeCheck=true` currently enables full Nix checks.
