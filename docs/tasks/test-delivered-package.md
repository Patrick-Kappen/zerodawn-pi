# Load the delivered Nix package with the pinned pi version in a test

Checks load source files. Test the package that users get.

## Source

- zerodawn-pi main: docs/ci-baseline.md (Behavior tests and gaps)

## Original text

- Load the delivered Nix package with the consumer's pinned pi version. Current checks load source files, not the delivered package.

Full section in the source:

| Contract | Evidence at baseline | Added protection |
|---|---|---|
| Release preparation | No test calls the release scripts | Real temporary Git repositories check version levels, unchanged components, generated notes, and release validation |
| Rejected release | An empty request changes the package version before returning failure | The failed request must leave files, index, and HEAD unchanged |
| Background jobs and checker | Each extension tests its own event name with a separate mock | Real extension registration and shell jobs check suspension, completion output, failure output, and checker continuation |
| Selection of affected tests | No script contract test | File inputs select the expected suites; extension changes include integration tests |

The empty-release test fails against the baseline script: the version changes from `0.4.0` to `0.4.1` despite exit status 1.
The fix checks for release content before writing any file.
Tests use expected outputs and public events, not private variable values.
The checker receives fixed classifier responses. No test calls a paid provider.

The next test work has concrete gaps, not a target percentage:

- Test publication after an interrupted push or GitHub Release creation. `ci-release.sh` still lacks a test.
- Load the delivered Nix package with the consumer's pinned pi version. Current checks load source files, not the delivered package.
- Test watchdog cancellation and recovery. Its three existing tests cover number parsing, clipping, and entry summaries only.
- Test the handoff warning through the checker. Current tests construct each side separately.

Existing subagent integration tests already start real tmux processes. Keep that coverage instead of adding a second test of the same path.
Private OAuth tests already cover payload hooks, tool names, streaming, and failures. Keep those contracts intact.
