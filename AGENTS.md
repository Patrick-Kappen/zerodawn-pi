# AGENTS.md

pi package with independent extensions in TypeScript. Nix flake with a Home Manager module.

## Layout

- `extensions/<name>/`: one extension, with `package.json`, `README.md`, `CHANGELOG.md` and tests.
- `shared/`: only add exports. Never change or remove one.
- Read the `AGENTS.md` of an extension before you change it.
- Read `docs/decisions.md` before a structural change. Add an entry for a new one.
- `TODO.md` files are the owner's notes. Do not act on them unless asked.

## Work

- Work in a worktree under `~/.worktrees` on a branch. Open a PR.
- Commit subject: `<scope>: what changed`, max 72 characters.
- Do not edit `CHANGELOG.md` files or versions. A release is its own PR.
- Do not add a dependency.
- Fail loud. Errors name the file or id and the next step.
- No comments, except for a reason the code cannot show.

## Same repositories

- This repository and zerodawn-pi-private share CI, `scripts/`, `justfile`, `flake.nix` checks, `biome.json` and `tsconfig.json`.
- Change them in both, in one PR each. Run `just sync-check`.
- When CI fails on drift, find the cause. Do not copy one side over the other.

## Tests and checks

- Run tests with `run_tests`. Run checks with `just check`.
- A warning is an error. Fix it.
- Add a test for each new behaviour and each bug fix.
- When CI fails, find the cause before you change code.
