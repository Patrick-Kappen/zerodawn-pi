#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failed=()
for manifest in extensions/*/package.json; do
  name="$(jq -r .name "$manifest")"
  tag="$(git tag --list "$name-v*" --sort=-v:refname | head -n1)"
  if [ -z "$tag" ]; then echo "compat: $name has no release yet"; continue; fi
  rm -rf "$work/src" && mkdir -p "$work/src/extensions"
  cp -r shared package.json node_modules "$work/src/"
  git archive "$tag" "extensions/$name" | tar -x -C "$work/src"
  echo "compat: $name at $tag"
  (cd "$work/src" && bun test "extensions/$name") || failed+=("$name@$tag")
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "compat: the released version of ${failed[*]} fails on the current shared/; bump that extension, or keep shared/ compatible" >&2
  exit 1
fi
