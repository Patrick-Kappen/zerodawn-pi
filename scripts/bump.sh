#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?usage: bump.sh VERSION [EXTENSION]}"
EXTENSION="${2-}"
cd "$(dirname "$0")/.."
test -z "$(git status --porcelain)" || { echo "bump: commit or stash your changes first" >&2; exit 1; }
if [ -n "${EXTENSION}" ]; then
  manifest="extensions/${EXTENSION}/package.json"
  [ -f "$manifest" ] || { echo "bump: $manifest does not exist" >&2; exit 1; }
  tag="${EXTENSION}-v${VERSION}"
else
  manifest=package.json
  tag="v${VERSION}"
fi
jq --arg v "${VERSION}" '.version = $v' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
biome format --write "$manifest"
git commit -q -m "release: $tag" "$manifest"
echo "committed $tag; push main and CI creates the tag"
