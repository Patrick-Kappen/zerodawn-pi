# Let quota drive the model ladder, then escalation on failure

The ladder now picks by availability only. Add quota: what is left, the forecast, and use it up before a reset. After that, step up to a heavier model after failed tries.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md
- zerodawn-pi main: extensions/subagents/README.md (Plan: Model ladder)

## Original text

One step at a time. Each step is its own PR.

7. Quota: use left this week, part of the week gone, forecast, reset close (use it up), IBM on or off. The ladder obeys it. Escalation on failure (a heavier model after failed tries) comes after quota.

README: - **Model ladder:** done, by availability only (see "Model ladder"). Later: quota, then escalation on failure.
