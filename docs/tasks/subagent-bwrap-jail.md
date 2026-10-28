# Run subagents in a bwrap jail

A subagent can now write everywhere. A bwrap jail limits writes to its worktree and its git data. The rest is read-only.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md
- zerodawn-pi main: extensions/subagents/README.md (Plan: Isolation)

## Original text

One step at a time. Each step is its own PR.

5. Jail with bwrap: the worktree read-write, `.git/objects` and the own `.git/worktrees/<name>`, `/nix/store` and `~/.pi/agent` read-only, network on.

README: - **Isolation:** each subagent has its own worktree (see "Worktrees"), later in a jail. See "Merge".
