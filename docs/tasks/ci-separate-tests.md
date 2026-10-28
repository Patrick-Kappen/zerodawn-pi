# Separate unit and integration tests

Unit tests must run fast and without tmux, processes or services. Integration tests go in their own group.

## Source

- zerodawn-pi main: docs/ci-release-plan.md (stage 2)
- branch tests/separate-suites (PR #121, private #33) works on this

## Original text

## 2. Separate unit and integration tests

Unit tests cover isolated logic, such as parsing, formatting, test selection, and release calculation.

- Run affected unit tests through `run_tests` during edits.
- Limit commit hooks to fast checks.
- Keep `just check` available for the complete local check.

Integration tests cover processes, files, sockets, tmux, Git, and connections between extensions.

- Put existing integration tests in an explicit group.
- Keep working tests intact where possible.
- Update agent rules and recipes to match the test groups.

Done when: unit tests run without external services, tmux sessions, or agent processes.
