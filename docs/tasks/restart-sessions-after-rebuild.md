# Add a tool to restart all pi sessions after a rebuild

After a rebuild, running sessions still use the old version. The tool waits until each one is idle, then restarts it in the same session.

## Source

- zerodawn-pi main: docs/todo.md (Backlog)

## Original text

- A tool to restart all running pi sessions after a rebuild. It waits until each session is idle, closes it, and starts it again in the same session, so it loads the new version.
