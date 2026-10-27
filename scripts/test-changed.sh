#!/usr/bin/env bash
# Runs the tests for the changed files that run_tests gives: the tests of each changed extension, every test for a
# change in shared/ or the manifest, and every check (nix flake check) for a change in the repository behaviour.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "test-changed: no files given. Run: just test-changed FILE..." >&2
  exit 2
fi

dirs=()
all=false
nix=false
for f in "$@"; do
  case "$f" in
    *.md) ;;
    extensions/*/*) dirs+=("./extensions/$(cut -d/ -f2 <<<"$f")") ;;
    integration/*) dirs+=("./integration") ;;
    shared/* | package.json | tsconfig.json) all=true ;;
    *) nix=true ;;
  esac
done

if $nix; then
  exec nix flake check --option warn-dirty false
fi
if $all; then
  exec bun test
fi
if [ ${#dirs[@]} -eq 0 ]; then
  echo "test-changed: only documentation changed: $*"
  exit 0
fi
dirs+=("./integration")
mapfile -t unique < <(printf '%s\n' "${dirs[@]}" | sort -u)
exec bun test "${unique[@]}"
