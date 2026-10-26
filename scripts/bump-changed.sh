#!/usr/bin/env bash
set -euo pipefail
LEVEL="${1:-minor}"
cd "$(dirname "$0")/.."
test -z "$(git status --porcelain)" || { echo "bump-changed: commit or stash your changes first" >&2; exit 1; }
case "${LEVEL}" in major|minor|patch) ;; *) echo "bump-changed: level must be major, minor or patch" >&2; exit 2;; esac
next() { IFS=. read -r a b c <<< "$1"; case "${LEVEL}" in major) echo "$((a+1)).0.0";; minor) echo "$a.$((b+1)).0";; patch) echo "$a.$b.$((c+1))";; esac; }
bumped=()
for manifest in shared/package.json extensions/*/package.json; do
  name="$(jq -r .name "$manifest")"; version="$(jq -r .version "$manifest")"
  tag="$(git tag --list "$name-v*" --sort=-v:refname | head -n1)"
  if [ -n "$tag" ] && git diff --quiet "$tag" -- "$(dirname "$manifest")"; then continue; fi
  if [ -n "$tag" ] && [ "$version" != "${tag#"$name-v"}" ]; then continue; fi
  # A component without a tag ships its current version as its first release; only a released one is bumped.
  if [ -n "$tag" ]; then new="$(next "$version")"; else new="$version"; fi
  jq --arg v "$new" '.version = $v' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"
  bumped+=("$name $version -> $new $(dirname "$manifest")")
done
version="$(jq -r .version package.json)"; new="$(next "$version")"
jq --arg v "$new" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
biome format --write package.json shared/package.json extensions/*/package.json >/dev/null
# Changelog sections from the commit subjects since the last tag; the "<name>: " prefix is dropped per extension.
today="$(date +%F)"
prepend() { local file="$1" text="$2" tmp; tmp="$(mktemp)"; { head -n1 "$file"; printf '\n%s\n' "$text"; tail -n +2 "$file"; } > "$tmp"; mv "$tmp" "$file"; }
root="## $new — $today"
for entry in "${bumped[@]}"; do
  read -r name _ _ to dir <<< "$entry"
  tag="$(git tag --list "$name-v*" --sort=-v:refname | head -n1)"
  if [ -n "$tag" ]; then lines="$(git log --no-merges --format='- %s' "$tag..HEAD" -- "$dir" | sed "s/^- $name: /- /")"; else lines="- First release."; fi
  [ -f "$dir/CHANGELOG.md" ] || printf '# Changelog\n' > "$dir/CHANGELOG.md"
  prepend "$dir/CHANGELOG.md" "$(printf '## %s — %s\n\n%s' "$to" "$today" "$lines")"
  root="$(printf '%s\n\n### %s %s\n\n%s' "$root" "$name" "$to" "$lines")"
done
[ -f CHANGELOG.md ] || printf '# Changelog\n' > CHANGELOG.md
prepend CHANGELOG.md "$root"
scripts/notes.sh
git add package.json shared extensions CHANGELOG.md README.md
summary="$(printf '%s\n' "${bumped[@]}" | awk '{print $1, $2, $3, $4}')"
git commit -q -m "release: v$new" -m "$summary"
printf 'package %s -> %s\n%s\n' "$version" "$new" "$summary"
