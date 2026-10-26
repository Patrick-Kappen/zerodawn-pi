2. Tool `subagent` in the main pi: start the supervisor when absent, connect, send a task.
3. Subagent side: connect, forward events, obey abort and steer. First test agent: Haiku 5.5, no thinking.
   - When the main pi is gone and the last agent finishes, shut down at once, not after the 2 hour timer.
4. Events in the UI of the main pi.
5. Overview in window 0.
   - Show client socket errors there; `lib/server.ts` now drops them with `socket.destroy()`.
6. Stop rules for a hung agent (no progress timeout, max turns).
7. Fixed flows and agent definitions.
