# Improvements:

- In general it does not behave like i want yet.
- A check command in a pipe (`just check | tail -3`) reports the exit code of the last command: green while lint failed. Decide: pipefail in the job script (changes `yes | head`), or a warning for a check in a pipe.
