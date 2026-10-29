# tests

Gives the agent the tool `run_tests`. It runs the tests for the files that changed since the last commit, and returns one line when they pass, or only the failures and warnings. Test and check commands in bash run through it, with the same short result. In a chain with other commands, such as `git add . && bun test && git commit`, bash runs the whole chain, and the test and check parts get the short result (`tests green: 3 pass, 0 fail`). It also puts the recipes of the project's `justfile` or `Makefile` in the system prompt, as `just <name>: <doc>`. The file is read again when it changes.

## run_tests

- `scope: "changed"` (default): the tests for the changed, new and deleted files of `git status`.
- `scope: "all"`: the recipe `test`, or else `bun test`.
- `path`: the project directory, such as a git worktree. Default: the current directory.

A call runs only when a file changed since the last run. Else it gives the earlier result, and nothing runs. The runs after an edit count too: when no file changed since the last of them, `run_tests` runs nothing.

## After an edit

After each `edit` or `write`, the extension runs the tests of that one file in the background, with the same selection as `changed`. Files that need no test and files outside git run nothing. The runs go one after another. A later edit of the same file replaces a run that did not start.

A green run gives no message. A red run gives the agent a message, as a steer during a run, else as a new turn. The message does not come when the file changed again during the run, and the same failure comes once. In print and json mode the agent waits for these runs before it settles.

The run gets the dev environment of the project: when the git root of the directory has an `.envrc`, the command runs through `direnv exec <git root>`. A blocked `.envrc` fails the run with the direnv message: run `direnv allow <git root>`. The check commands in bash run the same way; for a check that starts with `cd <dir> &&`, the directory is `<dir>`, so a check in a worktree gets the environment of that worktree.

How it picks the tests for `changed`:

1. The project has a recipe `test-changed *files`: `just test-changed <files>` (Makefile: `make test-changed FILES="<files>"`). The recipe gets every changed path, also deleted files and files that are not code. It runs the tests for them, fails for a changed code file without a test, and fails on a warning. This works for every language and test tool.
2. Else, a project with a `package.json` and only JavaScript or TypeScript changes: `bun test` with the changed test files and every test file that imports a changed file, directly or through other files. A change in `package.json`, `tsconfig*.json`, `bunfig.toml` or a lock file runs every test.
3. Else: an error that gives the contract of the recipe. This happens without a `package.json`, for a `package.json` that names vitest, jest, mocha or ava, and for a changed file that is not JavaScript or TypeScript (`.py`, `.sh`, `.nix`, ...).

Changes only in files that need no test (`*.md`, `*.txt`, images, `LICENSE`, `.gitignore`) run nothing.

A changed JavaScript or TypeScript file without a test is an error, also with the recipe. A file has a test when a test file (`*.test.*`, `*.spec.*`) imports it directly, or when a test file with the same name exists. For other languages the recipe checks this.

The result:

```
green: 38 pass, 0 fail · 1.2 s · log: out:3.2-C1.tests
```

`red` starts the line when a test fails, a changed file has no test, or the output has a warning. A failed test run shows the failures, without passed tests and runtime stack frames. A failed check and a warning show the diagnostics: each line with a location (`file:line:col`, `file(line,col)`), a warning or an error, once, with `(×n)` for a repeat. The same message at more places is one line with at most 10 places. A location on its own line (shellcheck `In a.sh line 3:`, deadnix `╭─[a.nix:2:5]`) goes in front of its message. Summary lines (`Found 1 warning.`) and context lines do not show. When no line matches, the last 20 lines show. The nix lines `warning: Git tree '…' is dirty` and `error (ignored): SQLite database '…' is busy` do not show.

A red check that the parser did not understand (no line matched, the result was cut, or no diagnostic has a location) is written to `check-anomalies.jsonl` in the session directory. `just check-findings` shows them. A warning line has "warn" in it (not in an option such as `--error-on-warnings`), or starts with `! ` (biome). The run stops after 10 minutes. A stop by the user ends the run and its child processes.

A run that takes more than 15 s continues in the background. The tool result then says so and ends the turn, so the user can chat. When the run ends, a message gives the short result to the agent: during a run as a steer message, else it starts a new turn. A second call for the same change does not start a second run. A new session stops the background runs. In print and json mode (`pi -p`), pi ends when the agent settles, so before it settles the extension waits for the next background run; its message then continues the agent.

## Bash

Each bash command goes through these steps, in this order:

1. A test command (`just test`, `bun test`, `bun x.test.ts`, `pytest`, `python -m unittest`, `cargo test`, `go test`, `dotnet test`, `Invoke-Pester`, ...): `run_tests` runs for the changed files, in the directory of a leading `cd <dir> &&`. The bash result is the `run_tests` result, and tells the agent to use `run_tests`. It runs only when a file changed since the last run.
2. A command that is the body of a recipe is blocked: run the recipe instead.
3. A check command (`just check`, `just lint`, `nix flake check`, `biome check`, `eslint`, `tsc`, `cargo clippy`, `ruff check`, `go vet`, ...): the extension runs it, and the bash result is the same short result as for the tests. A warning makes it red. When no file changed, it gives the earlier result and runs nothing. Outside git it runs each time.

For 1 and 3 nothing is blocked. The extension starts the run in `tool_call`, and bash runs `:` in place of the command. The `tool_result` hook waits for the run and replaces the result and its error state, so the pi UI shows green or red. The transcript keeps the command of the agent: pi gives `tool_call` a copy of the arguments.

A command counts only at the start of a command: after `;`, `&&`, `|`, `(`, `then` or `do`, and after `VAR=x`, `npx`, `bunx`, `uv run`, `poetry run`, `nix develop -c`, `timeout` or `time`. Text in quotes and heredocs does not count. The string of `bash -c`, `sh -c` and `pwsh -c` counts.

## Hint

A command of 80 characters or more that runs for the third time gets a hint in its result: add it as a recipe.

## Needs

`git`. `direnv` for a project with an `.envrc`. `bun` for a `package.json` project without the recipe. `just` in `PATH` for projects with a justfile. The extension fails loud when one is missing.

## Constants

`lib/recipes.ts`: `REPEAT_MAX`, `LONG`, `TEST_TOOLS`, `CHECK_TOOLS`, `WRAPPERS`. `lib/run.ts`: `TIMEOUT_MS`, `CHANGED_RECIPE`, `ALL_RECIPE`, `NO_TEST`, `JS_CONFIG`. `lib/report.ts`: `FAILURE_MAX`, `TAIL`, `WARNING`.

## Changes

<!-- changelog:start -->
## 0.9.0 — 2026-10-28

- run the tests of a file after each edit, report only red (breaking)

[All changes](CHANGELOG.md)
<!-- changelog:end -->
