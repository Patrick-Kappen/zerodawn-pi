# tests

Gives the agent the tool `run_tests`. It runs the tests for the files that changed since the last commit, and returns one line when they pass, or only the failures. It also puts the recipes of the project's `justfile` or `Makefile` in the system prompt, as `just <name>: <doc>`. The file is read again when it changes.

## run_tests

- `scope: "changed"` (default): the tests for the changed, new and deleted files of `git status`.
- `scope: "all"`: the recipe `test`, or else `bun test`.
- `rerun: true`: run again when no file changed. Without it, the tool gives the earlier result.
- `path`: the project directory, such as a git worktree. Default: the current directory.

How it picks the tests for `changed`:

1. The project has a recipe `test-changed *files`: `just test-changed <files>` (Makefile: `make test-changed FILES="<files>"`). The recipe picks the tests and fails for files without a test.
2. Else, a project with a `package.json`: `bun test` with the changed test files and every test file that imports a changed file, directly or through other files. A `package.json` that names vitest, jest, mocha or ava needs the recipe.
3. Else: an error that tells you to add the recipe.

A changed code file without a test is an error. A file has a test when a test file (`*.test.*`, `*.spec.*`) imports it directly, or when a test file with the same name exists.

The result:

```
green: 38 pass, 0 fail · 1.2 s
command: bun test --only-failures ./extensions/tests/lib/run.test.ts
log: ~/.pi/agent/sessions/…/out/3.2-C1.tests.log
```

When the tests fail, the line starts with `red`, and the failures follow without passed tests and runtime stack frames. The run stops after 10 minutes.

## Blocks

- A test command in bash (`just test`, `bun test`, `pytest`, `cargo test`, `go test`, ...). In its place, `run_tests` runs for the changed files, in the directory of a leading `cd <dir> &&`. The reason of the block gives its result, and tells the agent to use `run_tests`. `just check` and `nix flake check` are not blocked.
- A bash command that is the body of a recipe: run the recipe instead.

## Hint

A command of 80 characters or more that runs for the third time gets a hint in its result: add it as a recipe.

## Needs

`git`. `bun` for a `package.json` project without the recipe. `just` in `PATH` for projects with a justfile. The extension fails loud when one is missing.

## Constants

`lib/recipes.ts`: `REPEAT_MAX`, `LONG`, `TEST`. `lib/run.ts`: `TIMEOUT_MS`, `CHANGED_RECIPE`, `ALL_RECIPE`. `lib/report.ts`: `FAILURE_MAX`, `TAIL`.

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-25

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
