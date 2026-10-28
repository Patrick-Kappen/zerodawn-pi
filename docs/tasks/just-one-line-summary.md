# Make each just recipe end with a one-line summary

Agents read full check logs and that costs tokens. Each recipe must end with one line: what ran, and green or the first error. Then the cut output of `bash` is always enough.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- Checks through `just` only (`just check`, `just lint`, …), never by reading the full logs. The agent needs one or two lines: what ran, green or the first error. `bash` already cuts long output to head, error lines and tail; the recipes should print a one-line summary at the end so even that is enough.
