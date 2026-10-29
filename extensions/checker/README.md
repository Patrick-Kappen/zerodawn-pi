# checker

Before pi settles after a run, the checker asks a classifier model whether the agent really finished. When it did not, a hidden message sends the agent back for one more turn.

The checker judges only the outcome of the task. It sends the agent back only when the final answer names an open point that the user asked for and that the agent can close without the user.

The state for the classifier holds:
- the agent message before the last user message, so that a short reply such as "yes" has its context
- the last user message: the request
- the final answer, from before the first follow-up
- the rebuttal, the last assistant text after the last follow-up
- the number of follow-ups
- the reasons that earlier follow-ups already sent

The state holds no tool log. An error that the agent worked past during the run is not an open point.

One `classify()` call answers all questions:

| Question | Type | What |
|---|---|---|
| `open_point` | bool | the final answer names a point that stays open: an undone part, an unfixed error, an undone check, an offered or announced step |
| `in_request` | bool | the user asked for that work; a side finding, an unrelated failing test or an extra improvement is not in the request |
| `agent_can_do` | bool | the agent can close the point now with its tools, without the user; a merge, release, rebuild, restart, manual test, access or choice needs the user |
| `question_answerable` | bool | the final answer ends with a question that the agent can answer itself |

The checker sends the agent back only when `in_request` > 0.7, and then for one of these:
- `open_point` > 0.7 and `agent_can_do` > 0.7
- `question_answerable` > 0.7

The follow-up message is hidden and lists only the reasons that apply. The checker shows no notice for a follow-up. At most 3 follow-ups per user message: a tool call does not reset the count, because the agent that works on the points still answers the checker. After the limit, a warning shows the open points. A run after a follow-up that ends on assistant text with no tool call is a rebuttal: the checker does not check again and sends nothing. When the agent did tool calls and stops again, the checker asks again but leaves out every reason that an earlier follow-up for this user message already sent. A run that was aborted or failed is not checked. A run is also not checked while a bash job runs in the background, because the job report starts the next turn. The checker asks the bash extension with `{ running: false }` on the `pi.events` channel `bash:background-jobs`. A missing model or a failed classify call shows a warning and does not send the agent back.

The checker does not ask whether tests ran. CI runs both test groups. Commit hooks run static checks.

Every check goes to the session as a custom entry `checker` and as one JSON line to the log file.

## Environment

| Variable | Default | What |
|---|---|---|
| `PI_CHECKER_CLASSIFIER` | `typesafe/Decision-1` | classifier model as `provider/model` |
| `PI_CHECKER_LOG` | `~/.pi/agent/checker.jsonl` | JSONL log of every check |

## Changes

<!-- changelog:start -->
## 0.4.0 — 2026-10-28

- tests: separate unit and integration suites

[All changes](CHANGELOG.md)
<!-- changelog:end -->
