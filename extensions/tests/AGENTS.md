# tests

The `run_tests` tool, and the guard for test and check commands in bash. Read `README.md` for what it does.

- The tool result is short: one line for green, only failures and warnings for red. Never return the full output.
- A warning is red.
- Never let a test or check command in bash through with its full output.
- Never block a command for a word in quotes or a heredoc.
- Every error tells the agent what to make: a test, or the recipe `test-changed`.

## After a pi upgrade

- Make sure a blocked bash call in codemode is still blocked.
- Make sure pi still waits for an async `tool_call` handler.
