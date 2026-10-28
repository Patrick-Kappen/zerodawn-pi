# Run the right tool in place of a guardrail block

A block costs a full call and gives nothing. Guardrail blocks are half of all tool errors. Run the right tool and return its result.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Guardrails: 827 blocks (about $41) for `git status/log/diff`, `cat`, `grep`, `sed` in bash and checks run again. Each block costs a full call. Run the right tool and return its result, not a block.
- Guardrail blocks are 75 of 145 tool errors. Second: exit codes (28), codemode script failures (17).
