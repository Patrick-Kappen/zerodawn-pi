#!/usr/bin/env bash
# Runs when the dev shell starts: links node_modules to pi's packages in the store.
set -euo pipefail
# The central git hooks run .githooks/; a local core.hooksPath from an older shell bypasses them.
if git config --local --get core.hooksPath >/dev/null; then
  git config --local --unset core.hooksPath
fi
modules="${NODE_MODULES:?set by flake.nix}"
if [ -e node_modules ] && [ ! -L node_modules ]; then
  echo "shell-hook: node_modules is a directory, not the link to pi's packages; remove it: rm -rf node_modules" >&2
  exit 1
fi
ln -sfn "$modules" node_modules
