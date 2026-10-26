# shared

Helpers that more than one extension uses. No pi logic, no state: paths, the on-disk output store, and `config.json`.

## Compatibility rule

Extensions are versioned and tagged on their own, and `just compat` runs the tests of each extension's last release against the current `shared/`. So `shared/` only grows:

- Add an export, do not change the meaning or the signature of an existing one.
- A breaking change gets a new name; the old export stays until no tagged extension uses it.
- Every change here gets a line in `CHANGELOG.md` through the release flow, and a tag `shared-v<version>`.

## Modules

| Module | Exports | Used by |
|---|---|---|
| `util.ts` | `age` (ms → `1m05s`), `commandLine` (one line, max length), `absolutePath` (`~`, `@`, relative → absolute), `textOf` (text of tool content), `stripQuoted` (quotes and heredocs out of a shell command), `argSummary` (short summary of tool arguments) | bash, files, git, tests, ui |
| `store.ts` | where tool output lives: `sessionDir`, `storeDir` (`<session>/out`, `<session>/jobs`), `callNumber` (`3.2-C1`), `freeId`, `outFile`, `callFileId` and `callOutFile` (also for a codemode call `<id>/<n>`), `shorten` (`$HOME` → `~`) | bash, files, git |
| `config.ts` | `CONFIG_FILE`, `readConfig`, `config`: reads and checks `config.json` next to `package.json` | ast-grep, systemstate |

Tests: `util.test.ts`, `store.test.ts`, `config.test.ts`.

## Changes

<!-- changelog:start -->
## 0.2.0 — 2026-10-26

- file ids for codemode tool calls

[All changes](CHANGELOG.md)
<!-- changelog:end -->
