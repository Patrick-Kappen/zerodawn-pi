# Run the right tool in place of a guardrail block

A block costs a full call and gives nothing. Guardrail blocks are half of all tool errors. Run the right tool and return its result.

## Status 2026-10-29

- PR #153: no git or file view guard. A git read, file view or search in bash gets the output of the git, read or grep tool.
- PR #154: a lone file view runs the read tool, and a lone file write runs the write tool.
- Open: `sed -i` ([task](cost-sed-to-edit.md)), the wait guard, the recipe block, and checks that run again.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Guardrails: 827 blocks (about $41) for `git status/log/diff`, `cat`, `grep`, `sed` in bash and checks run again. Each block costs a full call. Run the right tool and return its result, not a block.
- Guardrail blocks are 75 of 145 tool errors. Second: exit codes (28), codemode script failures (17).

## Measurement 2026-10-28

| days | guard blocks | part of all tool calls | part of all tool errors |
|---|---|---|---|
| 2026-10-21 to 2026-10-26 | 20 to 84 per day | 0.4% to 1.7% | 5% to 30% |
| 2026-10-27 | 274 | 5.4% | 49% |
| 2026-10-28 to 10:15 | 27 | 5.1% | 50% |

- Each block sends the full context again: about 27 × 66k = 1.8M tokens, 5% of the tokens on 2026-10-28.
- Blocked in bash: `grep`, `rg`, `cat`, `head`, `sed`, `git diff`, `git status`, `git log`, a wait without a next step.
- Calls per user prompt: 12 on 2026-10-28, 5.4 to 11 before.
