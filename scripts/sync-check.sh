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
normalize() { sed "s/$2/REPO/g; s/${2//-/_}/REPO_/g" "$1" | sed '/^sibling := /d' | sed '/Repository behaviour matches/,/sync-check.sh/d'; }

files=(.github/workflows/ci.yml biome.json tsconfig.json .gitignore .envrc)
for f in scripts/*.sh; do files+=("$f"); done
# Only the repository-wide parts of justfile and flake.nix: the tasks and the dev shell are shared; the module and the package options are not.
section() { awk -v start="$2" -v end="$3" '$0 ~ start {p=1} p {print} $0 ~ end && p {exit}' "$1"; }

differ=()
for f in "${files[@]}"; do
  case "$f" in scripts/dev.sh) continue ;; esac
  if [ ! -f "$other/$f" ]; then differ+=("$f (missing in $other_name)"); continue; fi
  diff -q <(normalize "$f" "$self_name") <(normalize "$other/$f" "$other_name") >/dev/null || differ+=("$f")
done
for part in "checks = forAll" "devShells = forAll"; do
  a="$(section flake.nix "$part" '^      [)];' | sed "s/$self_name/REPO/g")"
  b="$(section "$other/flake.nix" "$part" '^      [)];' | sed "s/$other_name/REPO/g")"
  [ "$a" == "$b" ] || differ+=("flake.nix: $part block")
done
a="$(sed '/^# Start pi with all extensions/,$d' justfile | normalize /dev/stdin "$self_name")"
b="$(sed '/^# Start pi with all extensions/,$d' "$other/justfile" | normalize /dev/stdin "$other_name")"
[ "$a" == "$b" ] || differ+=("justfile (without the dev recipes)")

if [ ${#differ[@]} -gt 0 ]; then
  printf 'sync-check: %s and %s differ in repository behaviour; copy the change to the other repository:\n' "$self_name" "$other_name" >&2
  printf '  %s\n' "${differ[@]}" >&2
  exit 1
fi
echo "sync-check: $self_name and $other_name share the same repository behaviour"
