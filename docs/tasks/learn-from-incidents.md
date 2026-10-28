# Record mistakes when they occur and turn frequent ones into fixes

Each cost analysis reads the session logs again by hand. Record each mistake when it occurs, with the call that fixed it. A recipe counts them and names the candidates for a fix.

## Source

- Session 2026-10-28 (`01a17f63`), after the cost analysis of PR #119.

## Parts that exist

- `just check-findings` (`extensions/bash/tool/findings.ts`) reads the sessions and finds check results that did not help the agent.
- The tests extension writes `check-anomalies.jsonl` in each session directory.
- The checker stores its classification per run in the session (`custom` entry `checker`).

These cover one kind of mistake each. There is no common record.

## Design

1. Record: each extension writes a mistake at once to one file, for example `~/.pi/agent/incidents.jsonl`. Mistakes: a tool error, a guardrail block, a checker follow-up, a red test run, a correction by the user. Each record has a signature (tool and message without paths and numbers, for example `bash:guard:head-on-file`), the project, the session and the cost of the call.
2. Pair: the first good call after a mistake is almost always the fix. Store the pair "mistake, fix". Examples from the session of 2026-10-28:
   - `head file` in bash, then `read`.
   - `git status` in bash, then the git tool.
   - `pgrep -f "git push"` in a wait loop found its own command and waited until the timeout.
3. Promote: `just incidents` counts the signatures per week. A signature with 5 or more records in 3 or more sessions is a candidate. Fix types, in this order:
   - guardrail runs the right tool in place of a block (wrong tool for a known task);
   - ast-grep or semgrep rule (wrong code pattern);
   - script or recipe (same steps again and again);
   - skill entry (missing domain knowledge);
   - better tool description (tool used wrong).
   Prefer a fix in code over text in a skill or prompt: code works each time, text costs tokens in each call.
   Later: a cheap model gets the pairs of a candidate, writes the fix and opens a PR. The owner merges.
4. Verify: after the merge, the report shows the count of the signature before and after. A count that does not decrease opens the candidate again.

## Build

- Step 1: an export in `shared/` that writes an incident. Calls from bash, files, tests and checker.
- Steps 2 and 4: extend `findings.ts` to `just incidents`.
- Step 3 with the model and the PR comes later. The report alone already helps.

## Related

- [cost-error-causes](cost-error-causes.md), [cost-guardrail-run-tool](cost-guardrail-run-tool.md), [cost-rules-repeated-mistakes](cost-rules-repeated-mistakes.md), [cost-analysis-recipe](cost-analysis-recipe.md), [cost-first-time-right](cost-first-time-right.md)
