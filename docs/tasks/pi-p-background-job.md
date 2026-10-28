# Check live: pi -p with a background job prints a final report (v0.15.0)

In v0.14.0, `pi -p` stopped halfway when a background job ran. v0.15.0 must wait and print a report. Do a live test.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- Check live in v0.15.0: `pi -p` with a background job (`gh pr checks --watch`) waits for the result and prints a final report. In v0.14.0 it stopped halfway with empty output.
