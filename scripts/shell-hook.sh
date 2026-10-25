#!/usr/bin/env bash
# Runs when the dev shell starts: installs the git hooks and the pinned npm packages.
set -euo pipefail
# The global git config sets core.hooksPath to central hooks, and pre-commit refuses to install while it is set.
GIT_CONFIG_GLOBAL=/dev/null bash -c "${PRE_COMMIT_SHELL_HOOK:?set by flake.nix}"
if [ ! -d node_modules ] || [ bun.lock -nt node_modules/.bun-tag ] || [ package.json -nt node_modules/.bun-tag ]; then
  bun install --frozen-lockfile && touch node_modules/.bun-tag
fi
