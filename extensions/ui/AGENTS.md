# ui

Changes how pi draws the transcript by wrapping render methods of pi's TUI components (`lib/hook.ts`). Each feature in `features/` is one wrapped component; a missing method fails at load, which is intended. Check this extension first after a pi upgrade.
