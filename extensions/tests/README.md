# tests

Puts the recipes of the project's `justfile` or `Makefile` in the system prompt, as `just <name>: <doc>`. The file is read again when it changes.

## Blocks

- A bash command that is the body of a recipe: run the recipe instead.
- A test command (`just test`, `bun test`, `pytest`, `cargo test`, `nix flake check`, ...) that ran already in this turn without an `edit` or `write` since: use the earlier result. Add `# rerun` for a flaky test.

## Hint

A command of 80 characters or more that runs for the third time gets a hint in its result: add it as a recipe.

## Needs

`just` in `PATH` for projects with a justfile. The extension fails loud when it is missing.

## Constants

`lib/recipes.ts`: `REPEAT_MAX`, `LONG`, `RERUN`, `TEST`.

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-25

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
