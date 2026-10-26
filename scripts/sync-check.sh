#!/usr/bin/env bash
# Compare the repository behaviour files with the sibling repository; fail with the list of files that differ.
# Usage: sync-check.sh PATH_TO_OTHER_REPO
set -euo pipefail
cd "$(dirname "$0")/.."
other="${1:?usage: sync-check.sh PATH_TO_OTHER_REPO}"
[ -d "$other" ] || { echo "sync-check: $other is not a directory" >&2; exit 2; }

self_name="$(jq -r .name package.json)"
other_name="$(jq -r .name "$other/package.json")"
# The sibling name and the CI step that checks the sibling are the one intended difference.
normalize() { sed "s/$2/REPO/g; s/${2//-/_}/REPO_/g" "$1" | sed '/^sibling := /d' | sed '/Repository behaviour matches/,/ci-sync.sh/d'; }

files=(.github/workflows/ci.yml biome.json tsconfig.json .gitignore .envrc)
for f in scripts/*.sh; do files+=("$f"); done
# Only the repository-wide parts of justfile and flake.nix: the tasks and the dev shell are shared; the module and the package options are not.
section() { awk -v start="$2" -v end="$3" '$0 ~ start {p=1} p {print} $0 ~ end && p {exit}' "$1"; }

# differ lines: "<file>: <what>"; the sibling's commit is named so an older branch is a visible cause.
other_rev="$(git -C "$other" rev-parse --short HEAD 2>/dev/null || echo unknown)"
other_branch="$(git -C "$other" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
differ=()
show() {
  local label="$1" a="$2" b="$3" d n first
  d="$(diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") || true)"
  n="$(printf '%s\n' "$d" | grep -c '^[<>]' || true)"
  first="$(printf '%s\n' "$d" | grep -m1 '^[<>]' || true)"
  differ+=("$label: $n lines differ; first: ${first:0:100}")
}
for f in "${files[@]}"; do
  case "$f" in scripts/dev.sh|scripts/ci-sync.sh) continue ;; esac
  if [ ! -f "$other/$f" ]; then differ+=("$f: missing in $other_name"); continue; fi
  a="$(normalize "$f" "$self_name")"; b="$(normalize "$other/$f" "$other_name")"
  [ "$a" == "$b" ] || show "$f" "$a" "$b"
done
for part in "checks = forAll" "devShells = forAll"; do
  a="$(section flake.nix "$part" '^      [)];' | sed "s/$self_name/REPO/g")"
  b="$(section "$other/flake.nix" "$part" '^      [)];' | sed "s/$other_name/REPO/g")"
  [ "$a" == "$b" ] || show "flake.nix ($part block)" "$a" "$b"
done
a="$(sed '/^# Start pi with all extensions/,$d' justfile | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' | normalize /dev/stdin "$self_name")"
b="$(sed '/^# Start pi with all extensions/,$d' "$other/justfile" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' | normalize /dev/stdin "$other_name")"
[ "$a" == "$b" ] || show "justfile (without the dev recipes)" "$a" "$b"

if [ ${#differ[@]} -gt 0 ]; then
  {
    printf 'sync-check: %s (this checkout) and %s (%s @ %s) differ in repository behaviour.\n' "$self_name" "$other_name" "$other_branch" "$other_rev"
    printf '  %s\n' "${differ[@]}"
    printf 'Next: if the sibling is behind, merge or pull its branch first; otherwise copy the change to the other repository and push both.\n'
  } >&2
  exit 1
fi
echo "sync-check: $self_name and $other_name ($other_branch @ $other_rev) share the same repository behaviour"
