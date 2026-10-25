# stall-watchdog

Recovers a pi run that hangs without a visible error: a model stream that stops, or a tool that waits forever.

After two thirds of the threshold without activity, the watchdog collects evidence (stream events, running tools, CPU use of pi's child processes, the tail of the session) and asks a classifier model whether the run hangs for sure. If so, it aborts, goes back through the session tree to the last working point, and continues with `/unstick`. The third stall in one prompt stops the agent with a message.

| Command | What |
|---|---|
| `/unstick` | abort the hanging run, go back to the last working point and continue |

## Environment

| Variable | Default | What |
|---|---|---|
| `PI_WATCHDOG_STALL_S` | 180 | seconds without activity when no tool runs |
| `PI_WATCHDOG_TOOL_STALL_S` | 180 | seconds without activity while a tool runs; CPU use of child processes counts as activity |
| `PI_WATCHDOG_CERTAINTY` | 0.75 | minimum probability of "hangs" before the watchdog acts |
| `PI_WATCHDOG_CLASSIFIER` | `typesafe/jev-latest` | classifier model as `provider/model`; see pi's codemode docs for classifiers |

Without a classifier model of that name in the model registry, the watchdog never aborts.
