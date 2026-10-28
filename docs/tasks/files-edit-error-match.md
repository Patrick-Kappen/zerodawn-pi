# Stop matching pi's edit error text in files

The indent fix in `files` starts when pi's edit error contains `Could not find`. When pi changes that text, the fix stops and nobody sees it. Use a stable signal, or add a test that fails on a change.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- `files` wraps pi's `edit` and matches the error text `Could not find`; a wording change in pi silently disables the indent fix.
