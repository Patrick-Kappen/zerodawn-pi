#!/usr/bin/env bash
# Runs when the dev shell starts: installs the git hooks and links node_modules to pi's packages in the store.
set -euo pipefail
# The global git config sets core.hooksPath to central hooks, and pre-commit refuses to install while it is set.
GIT_CONFIG_GLOBAL=/dev/null bash -c "${PRE_COMMIT_SHELL_HOOK:?set by flake.nix}"
modules="${NODE_MODULES:?set by flake.nix}"
if [ -e node_modules ] && [ ! -L node_modules ]; then
  echo "shell-hook: node_modules is a directory, not the link to pi's packages; remove it: rm -rf node_modules" >&2
  exit 1
fi
ln -sfn "$modules" node_modules
