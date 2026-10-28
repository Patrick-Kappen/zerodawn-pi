# Connect formatting and nvimx diagnostics to file changes

Finish formatting before the agent uses the changed file again.
Collect LSP diagnostics from nvimx, not only Tree-sitter syntax errors.
This is part of the [automatic checks plan](automatic-checks-plan.md).

## Required behavior

- Inspect the existing nvimx configuration and connection options before adding an interface.
- Use the project's configured formatter.
- Use one coordinated format operation per file version.
- Wait for formatting before returning an edit or write result.
- Apply the same checks to detected bash and background changes.
- Wait only for a bounded period for diagnostics that match the current contents.
- Continue background collection when diagnostics need more time.
- Discard diagnostics for old file contents.
- Report missing servers, connection failures, and deadlines without claiming successful checks.
- Preserve unsaved editor changes; do not overwrite them during synchronization.
- Do not move the user's editor focus.

The current file tools use clean headless Neovim for syntax checks.
That does not provide diagnostics from the user's nvimx LSP session.
LSP diagnostics and debugger output are separate concerns.

## Evidence

Tests cover formatting changes, formatter failure, delayed diagnostics, stale diagnostics, and unavailable servers.
Tests cover concurrent writes and unsaved buffers without data loss.
A live nvimx check confirms current file positions and no focus change.
Measurements establish the bounded wait; this task sets no arbitrary sleep duration.

## Source

- Owner discussion: allow formatting and nvimx diagnostics before the agent continues.
