# Make the session cost analysis a recipe

The cost analysis was manual. A recipe makes it repeatable, with deduplication of forked messages.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

  - Session cost analysis as a recipe: dedupe forked messages by entry id and timestamp; per model, token type, context size, user turn, error cause and bash command.

## Measurement 2026-10-28

- Session files count forked and handed-off messages again: 2026-10-25 +79%, 2026-10-26 +29%, 2026-10-27 +15%. Count an assistant message once per `responseId`, a tool result once per `toolCallId`.
- Session files miss requests outside the main session. On 2026-10-28 to 13:13 these were 566 requests and 13.5M tokens, about 11% of all tokens:
  - subagent workers on `deepseek-v4.1-flash`: 307 requests, 12.4M tokens
  - checker on `Decision-1`: 126 requests
  - recall on `gpt-6-luna`: 97 requests
  - handoff card on `qwen3.6-35b-a3b`: 17 requests
  - watchdog on `jev-latest`: 15 requests
- The agentgateway log on meridian (`/var/lib/agentgateway/logs.db`, table `request_logs`) has every request with tokens, cache tokens, cost and duration. It starts on 2026-10-25 11:14 UTC; Anthropic tokens are complete from 2026-10-26. Codex requests before 2026-10-26 did not go through the gateway.
- Use the gateway log as the source for totals, and the session files for tool calls and errors.
