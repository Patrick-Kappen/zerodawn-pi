#!/usr/bin/env bash
set -euo pipefail
# The level of each component comes from the "Change:" trailers of its commits since its last tag:
# breaking -> major (minor below 1.0), feature -> minor, fix -> patch.
# LEGACY gives the change of commits without a trailer (made before the trailer rule); without it they fail.
LEGACY="${1:-}"
cd "$(dirname "$0")/.."
test -z "$(git status --porcelain)" || { echo "bump-changed: commit or stash your changes first" >&2; exit 1; }
case "${LEGACY}" in ""|fix|feature|breaking) ;; *) echo "bump-changed: the argument is the change of commits without a trailer: fix, feature or breaking" >&2; exit 2;; esac
rank() { case "$1" in fix) echo 1;; feature) echo 2;; breaking) echo 3;; esac; }
# Highest change of the non-release commits in a range, optionally limited to a path.
change_of() {
  local range="$1" path="${2:-.}" best=fix sha change missing=()
  while IFS= read -r sha; do
    change="$(git log -1 --format=%B "$sha" | git interpret-trailers --parse | sed -n 's/^Change: //p')"
    if [ -z "$change" ]; then
      [[ "$(git log -1 --format=%s "$sha")" == release:* ]] && continue
      [ -n "$LEGACY" ] || { missing+=("$(git log -1 --format='%h %s' "$sha")"); continue; }
      change="$LEGACY"
    fi
    [ "$(rank "$change")" -gt "$(rank "$best")" ] && best="$change"
  done < <(git rev-list --no-merges "$range" -- "$path")
  if [ ${#missing[@]} -gt 0 ]; then
    printf 'bump-changed: these commits have no "Change:" trailer:\n' >&2
    printf '  %s\n' "${missing[@]}" >&2
    printf 'Next: run again with the change of these commits: just bump-changed fix|feature|breaking\n' >&2
    exit 1
  fi
  echo "$best"
}
next() {
  local a b c
  IFS=. read -r a b c <<< "$1"
  case "$2" in
    breaking) if [ "$a" -eq 0 ]; then echo "$a.$((b+1)).0"; else echo "$((a+1)).0.0"; fi ;;
    feature) echo "$a.$((b+1)).0" ;;
    fix) echo "$a.$b.$((c+1))" ;;
  esac
}
bumped=()
bumped_any=false
for manifest in shared/package.json extensions/*/package.json; do
  name="$(jq -r .name "$manifest")"; version="$(jq -r .version "$manifest")"
  tag="$(git tag --list "$name-v*" --sort=-v:refname | head -n1)"
  if [ -n "$tag" ] && git diff --quiet "$tag" -- "$(dirname "$manifest")"; then continue; fi
  if [ -n "$tag" ] && [ "$version" != "${tag#"$name-v"}" ]; then continue; fi
  # A component without a tag ships its current version as its first release; only a released one is bumped.
  if [ -n "$tag" ]; then
    # A plain assignment, so that set -e stops the script when change_of fails.
    change="$(change_of "$tag..HEAD" "$(dirname "$manifest")")"
    new="$(next "$version" "$change")"
  else new="$version"; fi
  bumped+=("$name $version -> $new $(dirname "$manifest")")
  bumped_any=true
done
version="$(jq -r .version package.json)"
last="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
[ -n "$last" ] || { echo "bump-changed: no package tag v* exists; tag the first release by hand" >&2; exit 1; }
change="$(change_of "$last..HEAD")"
new="$(next "$version" "$change")"
# Reject an empty request before any file changes, so a failed run leaves no half release.
if [ "$bumped_any" = false ] && [ -z "$(git log --no-merges --format=%h "$last..HEAD" -- . ':(exclude)shared' ':(exclude)extensions')" ]; then
  echo "bump-changed: no commit since $last; nothing to release" >&2
  exit 1
fi
# Write only after every level is known, so a failure leaves no half release.
for entry in "${bumped[@]}"; do
  read -r _ _ _ to dir <<< "$entry"
  jq --arg v "$to" '.version = $v' "$dir/package.json" > "$dir/package.json.tmp" && mv "$dir/package.json.tmp" "$dir/package.json"
done
jq --arg v "$new" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
biome format --write package.json shared/package.json extensions/*/package.json >/dev/null
# Changelog sections from the commit subjects since the last tag; the "<name>: " prefix is dropped per extension.
today="$(date +%F)"
prepend() { local file="$1" text="$2" tmp; tmp="$(mktemp)"; { head -n1 "$file"; printf '\n%s\n' "$text"; tail -n +2 "$file"; } > "$tmp"; mv "$tmp" "$file"; }
root="## $new — $today"
for entry in "${bumped[@]}"; do
  read -r name _ _ to dir <<< "$entry"
  tag="$(git tag --list "$name-v*" --sort=-v:refname | head -n1)"
  if [ -n "$tag" ]; then
    lines="$(git log --no-merges --format='- %s%x09%(trailers:key=Change,valueonly)' "$tag..HEAD" -- "$dir" | sed "s/^- $name: /- /; s/\tbreaking$/ (breaking)/; s/\t.*$//")"
  else lines="- First release."; fi
  [ -f "$dir/CHANGELOG.md" ] || printf '# Changelog\n' > "$dir/CHANGELOG.md"
  prepend "$dir/CHANGELOG.md" "$(printf '## %s — %s\n\n%s' "$to" "$today" "$lines")"
  root="$(printf '%s\n\n### %s %s\n\n%s' "$root" "$name" "$to" "$lines")"
done
# Commits outside the components (repo, flake, ci, docs) go into the package section, so that it is never empty.
repo="$(git log --no-merges --format='- %s' "$last..HEAD" -- . ':(exclude)shared' ':(exclude)extensions')"
[ -z "$repo" ] || root="$(printf '%s\n\n### repository\n\n%s' "$root" "$repo")"
[ -f CHANGELOG.md ] || printf '# Changelog\n' > CHANGELOG.md
prepend CHANGELOG.md "$root"
scripts/notes.sh
git add package.json shared extensions CHANGELOG.md README.md
summary="$(printf '%s\n' "${bumped[@]}" | awk '{print $1, $2, $3, $4}')"
git commit -q -m "release: v$new" -m "$summary"
printf 'package %s -> %s\n%s\n' "$version" "$new" "$summary"
