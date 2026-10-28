# Let the view guard allow rg or grep in a loop that writes to a file

The guard blocks a loop with rg that writes to a file. That use reads nothing into the context, so the guard must allow it.

## Source

- zerodawn-pi main: extensions/files/TODO.md

## Original text

- The view guard blocks rg or grep in a loop whose output goes to a file (`for x in ...; do rg ... "$x"; done > file`).
