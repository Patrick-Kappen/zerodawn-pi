# core

`/ext` enables or disables pi's built-in extensions, loose extensions, package extensions, skills, prompts and themes for the session, then reloads.

| Command | What |
|---|---|
| `/ext` | list with toggles; `enter` or click toggles, `tab` switches between user and project scope, type to search |
| `/ext list` | the same list as text |
| `/ext on <name>` | enable; `--project` writes to `<cwd>/.pi/settings.json` |
| `/ext off <name>` | disable |

Writes `settings.json` in the format of `pi config` (`+path`, `-path`, package filters), atomically, and changes only the toggled entry. `/ext` cannot disable itself. MCP servers stay with `/mcp`.

A name that exists more than once needs its origin: `name@user`, `name@project`, `name@<package>`.

`lib/settings.ts` starts with a description of what `pi config` writes, found by running it.

## Changes

<!-- changelog:start -->
No release yet.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
