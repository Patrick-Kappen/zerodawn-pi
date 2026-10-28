# Build a small CI pipeline without repeated work

Static checks and unit tests in parallel, then integration and package checks. Each suite runs once.

## Source

- zerodawn-pi main: docs/ci-release-plan.md (stage 4)

## Original text

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
