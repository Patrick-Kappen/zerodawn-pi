# Give the watchdog a classifier default that works, or fail loud

The watchdog needs a classifier model. The default needs a private gateway. Without it the watchdog never stops a hung command and says nothing. Choose a default that works for everyone, or show an error.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- `watchdog` needs a classifier model (`PI_WATCHDOG_CLASSIFIER`, default `typesafe/jev-latest`). Without it the watchdog never aborts; decide on a default that works without a private gateway, or make it loud.
