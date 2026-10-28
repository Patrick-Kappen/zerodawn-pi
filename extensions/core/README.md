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

## System prompt

Core sets pi's custom prompt (`lib/prompt.ts`): a short preamble, `<workflow>` with the way of work, and `<pi_docs>` with the paths of the pi README, docs and examples. Pi then leaves out its own `<tools>`, `<rules>` and `<docs>` sections, so the tool guidelines and pi's default rules are gone. Each tool description is complete: what the tool does, when and how to use it, and what it returns. Project context, skills, cwd and the sections of other extensions stay. A SYSTEM.md or `--system-prompt` makes core fail with an error.

## Changes

<!-- changelog:start -->
## 0.4.0 — 2026-10-28

- tests: separate unit and integration suites

[All changes](CHANGELOG.md)
<!-- changelog:end -->
