# Give subagents and opencode the tests extension, not the full test output

Subagents load only `subagentExtensions`, and opencode has no pi extensions. They run tests and checks without the `tests` extension, so they read the full output. That costs tokens. Give them the short result too.

## Source

- zerodawn-pi main: TODO.md

## Original text

- Tests: subagents (they load only `subagentExtensions`) and `opencode` run test and check commands without the `tests` extension, with the full output.
