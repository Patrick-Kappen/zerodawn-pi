# ctx-manager

At the end of every turn, tool results and `bash-job` messages from more than 2 user turns ago and larger than 1500 characters are replaced in the model context by one line: tool name, size, first line, and the path of the full output when the result has one. The transcript on screen does not change.

The edits are written only when they free at least 16 KB together, so the prompt cache is not broken for a small gain. The footer shows the total freed size.

## Constants

`lib/select.ts`: `KEEP_TURNS`, `MIN_CHARS`, `BATCH_CHARS`.

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-25

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
