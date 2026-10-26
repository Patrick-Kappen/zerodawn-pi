One step at a time. Each step is its own PR.

3. Merge profile: a cheap model that only fixes; escalation after X tries (agent reset, then a heavier model). The supervisor, not the agent, watches the PR (webhook or polling): green or red, more work on red, ask or blocker. `done` only when the merge succeeded; for a release only when the release succeeded.
4. Coordination: before the final merge to main, check with the agents on other branches whether their release is ready or almost ready, or wait for "release after XYZ". One agent does the final merge and sends a message to all. On green: flake update and NixOS update on a worktree. Wait for a green PR, then a handoff to the owner.
5. Jail with bwrap: the worktree read-write, `.git/objects` and the own `.git/worktrees/<name>`, `/nix/store` and `~/.pi/agent` read-only, network on.
6. Profile: `copy:` for files that git does not have (config.json, .env, links). Move the limits (gate tries, tokens) from code to the profile.
7. Model ladder: take the first available model of `models`; check availability.
8. Quota: use left this week, part of the week gone, forecast, reset close (use it up), IBM on or off. The ladder obeys it.
9. Profile choice: the main agent knows which profile fits which task.
10. Stop rules for a hung agent (no progress timeout, max turns).
11. Overview in window 0.
    - Show client socket errors there; `lib/server.ts` now drops them with `socket.destroy()`.
12. UI as in README "UI (planned)": streaming, background, messages, tool `subagents`, `/subagents`, dashboard.
