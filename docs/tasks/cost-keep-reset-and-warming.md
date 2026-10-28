# Keep reset per task and cache warming

Large contexts and cache rewrites after idle were most of the cost. The changes of 2026-10-27 decreased both a lot. Keep them.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

## Cost analysis 2026-10-21 to 2026-10-28 (23,082 calls, $1694; forked copies counted once)

- Reset per task: 75% of the cost came from calls with 150k context or more, 81% after user turn 7. After the changes of 2026-10-27: 7%. Keep it.
- Cache rewrites after idle: $403 in the week (24% of the cost), after the warming change $5. Keep it.
