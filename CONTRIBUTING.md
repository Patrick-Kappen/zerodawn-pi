# Contributing

## Setup

`direnv allow` (or `nix develop`) gives you bun, tsc, the TypeScript LSP, biome, just, shellcheck and the nix linters, installs the git hooks, and installs the pinned pi types. `just check` runs everything CI runs.

## Branch and commit

- Work on a branch and open a pull request. A hook refuses commits on `main`.
- Commit subject: `<scope>: what changed`. Scope is an extension name, `shared`, `release`, `ci`, `docs`, `flake`, `repo` or `deps`. At most 72 characters. A hook checks it; the subjects become the changelog.
- One concern per PR. Keep the diff inside one extension when you can; CI then runs only its tests.

## Layout of an extension

`extensions/<name>/` with `index.ts` (registers tools, commands and events), code and tests in `lib/` (large extensions split further), `package.json` (name, version, description), `README.md`, `CHANGELOG.md`, `AGENTS.md`, and at least one `*.test.ts`. `nix flake check` fails when one of these is missing. An extension imports only from its own directory and `shared/`.

`shared/` only grows: add an export, never change or remove one. See `shared/README.md`.

## Checks

| Where | What |
|---|---|
| hook, commit | biome, shellcheck, nixfmt, statix, deadnix, gitleaks, commit subject |
| PR | commit subjects; `types` and the `tests-<name>` of the changed extensions (everything when a file outside `extensions/` changed); `compat` when `shared/` changed; `release-check` on a release PR |
| merge to `main` | `nix flake check` with every check, `compat` |

`just compat` runs the tests of each extension's last tagged version against the current `shared/`; it protects the only cross-extension contract.

## Release

Feature PRs do not touch versions or changelogs. When a set of changes is done:

1. On a clean `main`: `just bump-changed minor` (or `patch`, `major`). It bumps every extension and `shared` that changed since its last tag, bumps the package, writes the changelog sections from the commit subjects, refreshes the README blocks, and commits.
2. Open that commit as a PR. Edit the changelog wording there if you want. CI recognises a release PR (only versions, changelogs and READMEs changed) and runs `release-check` instead of the tests.
3. Merge. CI tags `v<version>`, `<extension>-v<version>` and `shared-v<version>` for every new version and creates the GitHub release from `CHANGELOG.md`.

Other commands: `just bump <version> [extension]` sets one version by hand; `just notes` rewrites the README changelog blocks; `just deps-hash` updates the hash of the pinned npm packages after a change of `bun.lock`.

## Sibling repository

Repository behaviour (`flake.nix` checks and dev shell, CI, `scripts/`, `justfile`, biome and tsconfig) is shared with `zerodawn-pi-private`. Change it in both and run `just sync-check`.

## Decisions

Structural choices are recorded in `docs/decisions.md` with a reason. Read it before you change the structure; add an entry when you do.
