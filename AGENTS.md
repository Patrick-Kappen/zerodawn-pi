# AGENTS.md

TypeScript extensions for pi, with a Nix flake and Home Manager module.

## Project rules

- Work in a branch and a worktree under `~/.worktrees`. Open a PR.
- Read the extension's `AGENTS.md` before changes. Keep extensions independent.
- Each extension needs `package.json`, `README.md`, `CHANGELOG.md`, and tests. New extensions start at 0.1.0.
- Only add exports to `shared/`. Never change or remove an export.
- Do not add a dependency.
- Keep unit tests free of file changes and external processes. Static fixture reads are allowed.
- Name integration tests `*.integration.test.ts`, or put them under `integration/`.
- Put behavior in `README.md`, design reasons in `docs/decisions.md`, and agent rules in `AGENTS.md`.
- Read `docs/decisions.md` before structural changes. Record new design decisions there.
- Put open work in `docs/todo/TODO.md`, the backlog in `docs/todo/BACKLOG.md`, and one file per task in `docs/tasks/`. These are the owner's notes. Do not act on them unless asked.

## Paired repositories

- Keep CI, `scripts/`, `justfile`, flake checks, `biome.json`, and `tsconfig.json` consistent with `zerodawn-pi-private`.
- Change shared tooling through one PR per repository. Pair branches by behavior, not by name.

## Commits and releases

- Use `<scope>: subject`, at most 72 characters.
- End each non-release commit with `Change: fix`, `Change: feature`, or `Change: breaking`.
- Do not edit versions or changelogs during normal work.
- Release only at the owner's request, in a separate PR.
- A release includes every component with merged changes since its last release.
