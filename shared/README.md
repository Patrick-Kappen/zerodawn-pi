# shared

Helpers that more than one extension uses. No pi logic, no state: paths, the on-disk output store, `config.json`, and the test run.

## Compatibility rule

Extensions are versioned and tagged on their own, and `just compat` runs the tests of each extension's last release against the current `shared/`. So `shared/` only grows:

- Add an export, do not change the meaning or the signature of an existing one.
- A breaking change gets a new name; the old export stays until no tagged extension uses it.
- Every change here gets a line in `CHANGELOG.md` through the release flow, and a tag `shared-v<version>`.

## Modules

| Module | Exports | Used by |
|---|---|---|
| `util.ts` | `age` (ms → `1m05s`), `commandLine` (one line, max length), `absolutePath` (`~`, `@`, relative → absolute), `textOf` (text of tool content), `stripQuoted` (quotes and heredocs out of a shell command), `argSummary` (short summary of tool arguments) | bash, files, git, tests, ui |
| `store.ts` | where tool output lives: `sessionDir`, `storeDir` (`<session>/out`, `<session>/jobs`), `callNumber` (`3.2-C1`), `freeId`, `outFile`, `callFileId` and `callOutFile` (also for a codemode call `<id>/<n>`), `shorten` (`$HOME` → `~`) | bash, files, git, tests |
| `config.ts` | `CONFIG_FILE`, `CONFIG_ENV`, `configFile`, `readConfig`, `config`: reads and checks `config.json` next to `package.json`, or the file in `ZERODAWN_PI_CONFIG` | ast-grep, systemstate, subagents |
| `select.ts` | `isCode`, `isTestFile`, `parseStatus` (paths of `git status`), `importers`, `selectTests` (tests for changed files, and the changed code files without a test) | tests |
| `report.ts` | `counts`, `diagnose`, `diagnostics`, `failures`, `warningCount`, `warnings`: the short parts of a test output | tests |
| `recipes.ts` | `Recipe`, `Recipes`, `parseJust`, `parseMake`, `loadRecipes` (justfile or Makefile of a directory) | tests |
| `testrun.ts` | `changedFiles` (git working tree against HEAD, with untracked files), `inGit`, `uncoveredOf`, `plan` (what to run for scope `changed` or `all`), `execute` (run argv in its own process group), `verdict` (red for a failed run, a time-out or a warning), `reader`, `Run`, `Plan`, `NO_TEST`, `CHANGED_RECIPE`, `TIMEOUT_MS` | tests, subagents |

Unit tests: `util.test.ts` and `report.test.ts`. Integration tests: `store.integration.test.ts`, `config.integration.test.ts`, and `testrun.integration.test.ts`. The tests of `select.ts`, `report.ts` and `recipes.ts` are in `extensions/tests/lib/`, through the re-exports there.

## Changes

<!-- changelog:start -->
## 0.13.0 — 2026-10-29

- bash: run a lone file view with read and a file write with write

[All changes](CHANGELOG.md)
<!-- changelog:end -->
