# ui

Changes how pi draws the transcript, by wrapping the render methods of pi's TUI components. When pi renames a method, the extension fails loud at load.

| Command | What |
|---|---|
| `/view [normal\|compact\|text\|silent]`, `alt+o` | transcript view: pi's own, tool calls as two lines, no tool calls or thinking, only the final answer. Flag `--view`. |
| `/messages [row\|rule\|off]` | message style: sender as a bullet with an elbow, a rule above each message, or pi's own. Flag `--messages`. |
| `/footer [tidy\|pi]` | one-line footer: folder, branch, session, context %, cost; model and thinking bar at the right |

Also:
- code blocks without fences; `diff` blocks with colored added and removed lines
- working indicator: `Thinking…` or `Writing…` with a moving light in the thinking color, no tool names
- a message that pi retried after an error is hidden in `text` and `silent` views

The user name in `row` style is the OS user name.

## Layout

`lib/hook.ts` wraps a render method of a pi component. Each file in `features/` is one wrapped component.

## Changes

<!-- changelog:start -->
## 0.2.0 — 2026-10-26

- docs: AGENTS.md of each extension as rules, facts to README

[All changes](CHANGELOG.md)
<!-- changelog:end -->
