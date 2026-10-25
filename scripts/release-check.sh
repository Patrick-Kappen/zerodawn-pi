#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
missing=()
for manifest in shared/package.json extensions/*/package.json; do
  name="$(jq -r .name "$manifest")"; version="$(jq -r .version "$manifest")"
  tag="$(git tag --list "$name-v*" --sort=-v:refname | head -n1)"
  [ -n "$tag" ] || continue
  git diff --quiet "$tag" -- "$(dirname "$manifest")" && continue
  [ "$version" != "${tag#"$name-v"}" ] || missing+=("$name (still ${version}, changed since $tag)")
done
if [ ${#missing[@]} -gt 0 ]; then
  printf 'release-check: bump these extensions, for example with just bump-changed:\n  %s\n' "${missing[@]}" >&2
  exit 1
fi
scripts/notes.sh
if ! git diff --quiet -- README.md shared/README.md extensions/*/README.md; then
  echo "release-check: the changelog blocks in the READMEs are stale; run just notes and commit" >&2
  git checkout -q -- README.md shared/README.md extensions/*/README.md
  exit 1
fi
echo "release-check: every changed extension has a new version, README changelog blocks are current"
