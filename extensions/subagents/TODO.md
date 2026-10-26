4. UI as in README "UI (planned)": streaming, background, messages, tool `subagents`, `/subagents`, dashboard.
5. Overview in window 0.
   - Show client socket errors there; `lib/server.ts` now drops them with `socket.destroy()`.
6. Stop rules for a hung agent (no progress timeout, max turns).
7. Fixed flows and agent definitions.
