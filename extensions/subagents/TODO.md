One step at a time. Each step is its own PR.

1. Profile format: agree on PROFILES.md and close its open questions.
3b. Done gate: when the subagent settles, the supervisor runs the whole repository test set (like `run_tests` with scope all) and the `checks` of the profile.
   - No tests: do not fail. Mark "no tests" to the main agent.
   - The description of "done" is still open.
   - Green: the extension asks the subagent for a short, specific done description. Only that goes to the main agent (replaces the 8000 character final text).
   - Red: the failures go back to the same subagent.
4. Model ladder: take the first available model of `models`; check availability.
5. Isolation through window 0: a worktree and branch, or a copy without `.git`, plus needed files; the agent in a jail; merge into a merge branch at the end.
6. Quota: use left this week, part of the week gone, forecast, reset close (use it up), IBM on or off. The ladder obeys it.
7. Retries: max tries, agent reset with a handoff.
8. Profile choice: the main agent knows which profile fits which task.
9. Stop rules for a hung agent (no progress timeout, max turns).
10. Overview in window 0.
    - Show client socket errors there; `lib/server.ts` now drops them with `socket.destroy()`.
11. UI as in README "UI (planned)": streaming, background, messages, tool `subagents`, `/subagents`, dashboard.
