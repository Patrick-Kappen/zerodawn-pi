# Set the thinking level per step, never to or from off

Low, medium and high switches keep the cache. Use a low level for simple steps. Do not switch to or from off, that breaks the cache.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Thinking level per step: `pi.setThinkingLevel()` exists. On Anthropic models with mid-conversation effort, low/medium/high switches keep the cache (11 of 11 within 5 min). Only off to on breaks it (haiku, 2 of 3). Do not switch to or from off.
