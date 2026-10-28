# Find why many random things go wrong

Agent work often fails in ways that look random. Find the causes and remove them with automation.

## Source

- User, 2026-10-29

## Original text

- Figure out why a lot of random things happen (probably cause git is not updated, worktrees not removed, no automation on these things, agents calling elaborate scripts with && && &&).

## Seen on 2026-10-29

- `git fetch` failed: "Permission denied (publickey)", same cause as the commit below. The agent cannot update from origin, so it works on an old `main`.
- `git commit` failed: "Couldn't get agent socket?", "failed to write commit object". Commit signing needs the SSH agent. `ssh-agent.service` runs with the signing key, but pi does not get `SSH_AUTH_SOCK`. With `SSH_AUTH_SOCK=/run/user/$UID/ssh-agent` commit and push work.
- `just lint && git add && git commit && git push` as one bash call: the check interceptor ran only `just lint`. The commit did not run and no message said so (see bash-chained-check).
- A bash call with `git commit` stopped with SIGTERM after 10 s, during the pre-commit hook. A `pi -p` test also stopped after 10 s. The cause is not known.
- The pre-commit hook runs the full test suite. On `main` (d4e7f00) it gives 7 failures and 2 errors in 536 tests. So each commit fails, also a commit with only docs. Find which tests fail and fix them.
- The opencode tool hid the real error ("Free usage limit reached") and showed only `exit 1`.

## Causes to check

- `main` is not updated: no fetch before a worktree starts.
- Merged worktrees and branches stay; nothing removes them.
- No automation for these steps; the agent does them by hand each time.
- Agents chain many commands with `&&`; one part fails or is skipped, and the agent does not see which.
