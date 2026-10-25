# watchdog

Aborts a run that hangs and continues from the last good point via `/unstick`. Needs a classifier model (`PI_WATCHDOG_CLASSIFIER`, default `typesafe/jev-latest`); without it the watchdog never aborts. Thresholds come from environment variables, documented at the top of `index.ts`.
