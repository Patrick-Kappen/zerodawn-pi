# Let idle agents do a handoff and start fresh

The user runs many agents. Idle agents with a large context cost tokens on each cache warm. Make handoff part of context management, so an idle agent starts fresh.

## Source

- zerodawn-pi main: extensions/ctx-manager/TODO.md

## Original text

- Handoff should be a part of this, cause i orchastrate a lot. Idle agents costs tokens.
- Idle agents could handle a hand-off and start fresh.
