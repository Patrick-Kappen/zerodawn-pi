# tests

The `run_tests` tool, and the guard for test and check commands in bash. Read `README.md` for what it does.

- The tool result is short: one line for green, only failures and warnings for red. Never return the full output.
- A warning is red.
- Never let a test or check command in bash through with its full output.
- Do not block a test or check command. Replace its result, so green shows as green.
- Never wait in a `tool_call` handler. Pi runs them one after another, also for parallel calls.
- Never block a command for a word in quotes or a heredoc.
- Every error tells the agent what to make: a test, or the recipe `test-changed`.

## After a pi upgrade

- Make sure `tool_call` still gets a copy of the arguments (`validateToolArguments`), so the transcript keeps the original command.
- Make sure `tool_result` can still set `isError`, also for nested calls from codemode.
- Make sure `sendMessage` with `triggerTurn` and `steer` still reaches the agent during a run.
