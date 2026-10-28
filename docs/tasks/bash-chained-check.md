# Run the full chained command when it holds a check, or fail loud

In `git commit ... && just check` the interceptor runs only the check. The commit silently does not run. Run all parts, or stop with an error.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- `bash`: the check interceptor runs only the check of a chained command (`git commit ... && just check`). The other parts do not run, with no message. Run the full command, or fail loud.
