# checker

Before pi settles after a run, the checker asks a classifier model whether the agent really finished. When it did not, a hidden message sends the agent back for one more turn.

The state for the classifier holds the data of the run since the last user message:
- the request
- the final answer
- the last tool errors
- the changed files
- the checks after the last change
- the tool counts
- the number of follow-ups

One `classify()` call answers all questions:

| Question | Type | What |
|---|---|---|
| `status` | choice | `done`, `incomplete`, `blocked` or `question` |
| `open_error` | bool | an error stays unfixed |
| `in_scope` | bool | fixing it belongs to the task |
| `question_answerable` | bool | the agent can answer its own question with code, docs or tools |
| `verified` | bool | a passing check ran after the last change |
| `completeness` | score 0–3 | how complete the answer is |
| `rule_violation` | bool | work outside the request; only logged |

The checker sends the agent back when one of these is true:
- `open_error` > 0.7 and `in_scope` > 0.6
- `status` is `question` and `question_answerable` > 0.7
- files changed and `verified` < 0.3
- `status` is `incomplete` with confidence > 0.7, or `completeness` ≤ 1

The follow-up message lists only the reasons that apply. At most 3 follow-ups per user message; then a warning shows the open points. A run that was aborted or failed is not checked. A missing model or a failed classify call shows a warning and does not send the agent back.

Every check goes to the session as a custom entry `checker` and as one JSON line to the log file.

## Environment

| Variable | Default | What |
|---|---|---|
| `PI_CHECKER_CLASSIFIER` | `typesafe/Decision-1` | classifier model as `provider/model` |
| `PI_CHECKER_LOG` | `~/.pi/agent/checker.jsonl` | JSONL log of every check |

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-27

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
