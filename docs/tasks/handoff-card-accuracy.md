# Make the handoff card accurate and keep it on the task

The handoff card is not accurate and does not stay on the task. It shows much information that has no relation to the task.

## Source

- User, 2026-10-28, after the handoff of session `2026-10-28T18-49-47-550Z_01a183d8` (nixos-config).

## Original text

- "Handoff is not accurate and doesn't stick to task, shows a lot of random info."

## Seen in that handoff

- The task was the v0.20.0 release follow-up in zerodawn-pi and zerodawn-pi-private. The facts were all about the session directory nixos-config: the active system, dirty files and 5 worktrees of nixos-config. None of them were part of the task.
- The facts did not show the state of the two repositories of the task.
- The first dirty path lost its first letter (`ackages/...`). PR #136 fixes this.
- "State" and "In progress" repeat the same text with different words.

## Done when

- The card shows facts only for the repositories and items of the task.
- Each line of the card is true at the time of the handoff, and a test proves it for the facts from code.
