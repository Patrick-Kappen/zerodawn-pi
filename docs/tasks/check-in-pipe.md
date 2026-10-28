# Report a failing check in a pipe as a failure

`just check | tail -3` gives the exit code of `tail`, so a failed lint shows green. Use pipefail in the job script, or warn on a check in a pipe.

## Source

- zerodawn-pi main: extensions/bash/TODO.md
- branch check-pipefail (PR #123) works on this

## Original text

- A check command in a pipe (`just check | tail -3`) reports the exit code of the last command: green while lint failed. Decide: pipefail in the job script (changes `yes | head`), or a warning for a check in a pipe.
