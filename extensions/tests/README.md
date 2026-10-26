# tests

Gives the agent the tool `run_tests`. It runs the tests for the files that changed since the last commit, and returns one line when they pass, or only the failures and warnings. Test and check commands in bash run through it, with the same short result. It also puts the recipes of the project's `justfile` or `Makefile` in the system prompt, as `just <name>: <doc>`. The file is read again when it changes.

## run_tests

- `scope: "changed"` (default): the tests for the changed, new and deleted files of `git status`.
- `scope: "all"`: the recipe `test`, or else `bun test`.
- `rerun: true`: run again when no file changed. Without it, the tool gives the earlier result.
- `path`: the project directory, such as a git worktree. Default: the current directory.

How it picks the tests for `changed`:

1. The project has a recipe `test-changed *files`: `just test-changed <files>` (Makefile: `make test-changed FILES="<files>"`). The recipe gets every changed path, also deleted files and files that are not code. It runs the tests for them, fails for a changed code file without a test, and fails on a warning. This works for every language and test tool.
2. Else, a project with a `package.json` and only JavaScript or TypeScript changes: `bun test` with the changed test files and every test file that imports a changed file, directly or through other files. A change in `package.json`, `tsconfig*.json`, `bunfig.toml` or a lock file runs every test.
3. Else: an error that gives the contract of the recipe. This happens without a `package.json`, for a `package.json` that names vitest, jest, mocha or ava, and for a changed file that is not JavaScript or TypeScript (`.py`, `.sh`, `.nix`, ...).

Changes only in files that need no test (`*.md`, `*.txt`, images, `LICENSE`, `.gitignore`) run nothing.

A changed JavaScript or TypeScript file without a test is an error, also with the recipe. A file has a test when a test file (`*.test.*`, `*.spec.*`) imports it directly, or when a test file with the same name exists. For other languages the recipe checks this.

The result:

```
green: 38 pass, 0 fail · 1.2 s
command: bun test --only-failures ./extensions/tests/lib/run.test.ts
log: ~/.pi/agent/sessions/…/out/3.2-C1.tests.log
```

`red` starts the line when a test fails, a changed file has no test, or the output has a warning. A failure shows the failures, without passed tests and runtime stack frames. A warning shows each warning line with its context. A warning line has "warn" in it (not in an option such as `--error-on-warnings`), or starts with `! ` (biome). The run stops after 10 minutes. A stop by the user ends the run and its child processes.

## Bash

Each bash command goes through these steps, in this order:

1. A test command (`just test`, `bun test`, `bun x.test.ts`, `pytest`, `python -m unittest`, `cargo test`, `go test`, `dotnet test`, `Invoke-Pester`, ...) is blocked. In its place, `run_tests` runs for the changed files, in the directory of a leading `cd <dir> &&`. The reason of the block tells the agent to use `run_tests` and gives the result. `# rerun` in the command runs it again when no file changed.
2. A command that is the body of a recipe is blocked: run the recipe instead.
3. A check command (`just check`, `just lint`, `nix flake check`, `biome check`, `eslint`, `tsc`, `cargo clippy`, `ruff check`, `go vet`, ...) is blocked and runs in place, with the same short result as the tests. A warning makes it red. When no file changed, it gives the earlier result; `# rerun` runs it again.

A command counts only at the start of a command: after `;`, `&&`, `|`, `(`, `then` or `do`, and after `VAR=x`, `npx`, `bunx`, `uv run`, `poetry run`, `nix develop -c`, `timeout` or `time`. Text in quotes and heredocs does not count. The string of `bash -c`, `sh -c` and `pwsh -c` counts.

A blocked call shows as an error in the pi UI, also when the result is green: pi skips the `tool_result` hook for a blocked call.

## Hint

A command of 80 characters or more that runs for the third time gets a hint in its result: add it as a recipe.

## Needs

`git`. `bun` for a `package.json` project without the recipe. `just` in `PATH` for projects with a justfile. The extension fails loud when one is missing.

## Constants

`lib/recipes.ts`: `REPEAT_MAX`, `LONG`, `TEST_TOOLS`, `CHECK_TOOLS`, `WRAPPERS`. `lib/run.ts`: `TIMEOUT_MS`, `CHANGED_RECIPE`, `ALL_RECIPE`, `RERUN`, `NO_TEST`, `JS_CONFIG`. `lib/report.ts`: `FAILURE_MAX`, `TAIL`, `WARNING`.

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-25

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
