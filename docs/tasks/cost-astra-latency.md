# Find why gpt-6-astra became slower

gpt-6-astra takes 19.3 s per call on 2026-10-28. Before, it took 14 s. Opus became faster in the same time: 5.5 s, before 7.1 s. Find the cause: the gateway, the transport, the context size or the provider.

## Source

- pi sessions from 2026-10-21 to 2026-10-28 10:15, measured in a session on 2026-10-28.

## Original text

- gpt-6-astra: 19.3 s per call on 2026-10-28, 14 s before. claude-opus-5-5: 5.5 s, 7.1 s before.
- One session had WebSocket failures to the gateway ("Expected 101 status code") and a fallback to SSE.
