#!/usr/bin/env bash
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "test-changed: no files given. Run: just test-changed FILE..." >&2
  exit 2
fi

dirs=()
all=false
integration=false
nix=false
for f in "$@"; do
  case "$f" in
    *.md) ;;
    integration/* | *.integration.test.ts) integration=true ;;
    extensions/*/*) dirs+=("./extensions/$(cut -d/ -f2 <<<"$f")") ;;
    shared/* | package.json | tsconfig.json) all=true ;;
    *) nix=true ;;
  esac
done

if $nix; then
  exec nix flake check --option warn-dirty false
fi
if $all; then
  bun test --path-ignore-patterns '**/*.integration.test.ts' --path-ignore-patterns '**/integration/**'
elif [ ${#dirs[@]} -gt 0 ]; then
  mapfile -t unique < <(printf '%s\n' "${dirs[@]}" | sort -u)
  bun test "${unique[@]}" --path-ignore-patterns '**/*.integration.test.ts' --path-ignore-patterns '**/integration/**'
elif ! $integration; then
  echo "test-changed: only documentation changed: $*"
fi
if $integration; then
  exec bun test .integration.test.ts integration/
fi
