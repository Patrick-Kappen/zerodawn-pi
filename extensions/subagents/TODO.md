2a. Tool `subagent` in the main pi: find or start the supervisor, connect, send hello. Check at `session_start` for a running `pi-sub-<id>`. No agent starts yet.
3. Supervisor starts a subagent (Haiku 5.5, no thinking). The extension in the subagent connects and sends events.
   - When the main pi is gone and the last agent finishes, shut down at once, not after the 2 hour timer.
4. UI as in README "UI (planned)": streaming, background, messages, tool `subagents`, `/subagents`, dashboard.
5. Overview in window 0.
   - Show client socket errors there; `lib/server.ts` now drops them with `socket.destroy()`.
6. Stop rules for a hung agent (no progress timeout, max turns).
7. Fixed flows and agent definitions.
