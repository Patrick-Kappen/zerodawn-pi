# Make bash a real background call

A bash call still blocks the agent and the user. It must run in the background.

## Source

- User, 2026-10-29

## Original text

- Bash is still not a background call.

## Seen on 2026-10-29

- A `git commit` with a pre-commit hook of about 24 s ran in the foreground and stopped with SIGTERM after 10 s. Only with `background: true` did it finish.
- Related: research-background-run, ui-background, tests-background-result.
