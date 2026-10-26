# AGENTS.md

pi package with independent extensions in TypeScript. Nix flake with a Home Manager module.

## Layout

- `extensions/<name>/`: one extension. `index.ts` registers; code and tests in `lib/` (or `tool/`, `ui/`, `screen/`, `features/` for the big ones). Every extension has `package.json` (name, version), `README.md`, `CHANGELOG.md`, and at least one `*.test.ts`; the flake fails without them.
- `shared/`: helpers used by more than one extension. Only add exports; never change or remove one. See `shared/README.md`.
- `docs/decisions.md`: why things are the way they are. Read it before a structural change; add a numbered entry when you make one.
- Each extension has its own `AGENTS.md` with what it does, what it needs, and what to check after a pi upgrade. Read it before you change that extension.
- `TODO.md` files are the owner's notes. Do not act on them unless asked.

## Rules

- Repository behaviour (`flake.nix` checks and dev shell, `.github/workflows/ci.yml`, `scripts/`, `justfile`, `biome.json`, `tsconfig.json`) is shared with [zerodawn-pi-private](https://github.com/Patrick-Kappen/zerodawn-pi-private). Change it in both and run `just sync-check`; CI of the private repository fails on drift.
- Commit subject: `<scope>: what changed`, scope is an extension name, `shared`, `release`, `ci`, `docs`, `flake`, `repo` or `deps`. Max 72 characters. The subjects become the changelog.
- Work on a branch and open a PR; `main` is protected by a hook. CI tests only what changed on a PR, everything on `main`.
- Do not edit `CHANGELOG.md` files or versions by hand. A release is `just bump-changed <level>` on a clean `main`, as its own PR.
- Do not add a dependency. pi and its packages come from the `llm-agents` flake input; `nix flake update llm-agents` follows a new pi.
- Fail loud: no fallback that hides a missing input. Errors name the file or the id and the next step.
- No comments except for a reason the code cannot show. English everywhere.

## Checks

- `just check`: biome, tsc, bun test, `nix flake check`.
- `just test`, `just types`, `just lint` for one of them.
- `just dev` starts pi with all extensions in a tmux sandbox; `just dev-screen`, `just dev-send`, `just dev-stop`.
