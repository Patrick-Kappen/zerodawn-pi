# checker

Before pi settles after a run, the checker asks a classifier model whether the agent really finished. When it did not, a hidden message sends the agent back for one more turn.

The state for the classifier holds the data of the run since the last user message:
- the request
- the final answer
- the last tool errors
- the changed files
- the tool counts
- the number of follow-ups

One `classify()` call answers all questions:

| Question | Type | What |
|---|---|---|
| `status` | choice | `done`, `incomplete`, `blocked` or `question` |
| `open_error` | bool | an error stays unfixed |
| `in_scope` | bool | fixing it belongs to the task |
| `question_answerable` | bool | the agent can answer its own question with code, docs or tools |
| `next_step_offered` | bool | the answer offers a step in scope that the agent can do without a user choice |
| `completeness` | score 0–3 | how complete the answer is |
| `rule_violation` | bool | work outside the request; only logged |

The checker sends the agent back when one of these is true:
- `open_error` > 0.7 and `in_scope` > 0.6
- `status` is `question` and `question_answerable` > 0.7
- `next_step_offered` > 0.7
- `status` is `incomplete` with confidence > 0.7, or `completeness` ≤ 1

The follow-up message is hidden and lists only the reasons that apply. The checker shows no notice for a follow-up. At most 3 follow-ups in a row: a tool call of the agent sets the count back to 0, so a long run with progress is checked to the end. After 3 follow-ups without a tool call, a warning shows the open points. A run that was aborted or failed is not checked. A run is also not checked while a bash job runs in the background, because the job report starts the next turn. The checker asks the bash extension with `{ running: false }` on the `pi.events` channel `bash:background-jobs`. A missing model or a failed classify call shows a warning and does not send the agent back.

The checker does not ask whether tests ran. The pre-commit hook and CI run the full test suite.

Every check goes to the session as a custom entry `checker` and as one JSON line to the log file.

## Environment

| Variable | Default | What |
|---|---|---|
| `PI_CHECKER_CLASSIFIER` | `typesafe/Decision-1` | classifier model as `provider/model` |
| `PI_CHECKER_LOG` | `~/.pi/agent/checker.jsonl` | JSONL log of every check |

## Changes

<!-- changelog:start -->
## 0.2.0 — 2026-10-27

- send back an offered step, no notice per follow-up

- also check runs that end on assistant text

- count follow-ups in a row; a tool call resets the count

- shorter follow-up text, no reason for skipped tests

- shorter follow-up text, no reason for skipped tests

[All changes](CHANGELOG.md)
<!-- changelog:end -->
