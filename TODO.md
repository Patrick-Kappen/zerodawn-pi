# Improvements

- UI: move the tool call view to `shared/`, so every extension uses it. It must show better what a tool call does.
- Research: how to run everything in the background, without trouble for the agent or the user.
- Tests: subagents (they load only `subagentExtensions`) and `opencode` run test and check commands without the `tests` extension, with the full output.
