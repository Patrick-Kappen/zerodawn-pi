# Send sed -i in bash to the edit tool

`sed -i` skips the edit tool and its syntax check. Route it to edit.

## Plan

Build on the shell parser ([task](bash-shell-parser.md)) and on the tool routes of PR #154.

- A bash command that is only `sed -i EXPR FILE` on one file runs the edit tool.
- The real `sed EXPR` runs on the file content, so the result is the same as in the shell.
- The edit gets only the changed lines, each with enough context to be unique in the file.
- No change gives the note that `sed` changed nothing, and no edit call.
- In a chain, with more files, or with other options, `sed -i` runs as written.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- `sed -i` in bash: 241 times, past the edit tool and its syntax check. Send it to edit.
