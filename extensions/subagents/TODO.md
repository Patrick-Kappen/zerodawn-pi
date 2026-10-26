1. Supervisor: start, socket, register in `/tmp/pi-sub-<id>/`, 2 hour timer. No subagents, no UI.
2. Tool `subagent` in the main pi: start the supervisor when absent, connect, send a task.
3. Subagent side: connect, forward events, obey abort and steer. First test agent: Haiku 5.5, no thinking.
4. Events in the UI of the main pi.
5. Overview in window 0.
6. Stop rules for a hung agent (no progress timeout, max turns).
7. Fixed flows and agent definitions.
