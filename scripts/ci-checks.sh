#!/usr/bin/env bash
# The checks CI runs. Usage: ci-checks.sh pr BASE_SHA | ci-checks.sh main BASE_SHA
# Every failure prints what failed, where, and the next step; the exit code is 1.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:?usage: ci-checks.sh pr BASE_SHA | ci-checks.sh main BASE_SHA}"
system=x86_64-linux

fail() { printf 'ci: %s\n' "$1" >&2; [ $# -gt 1 ] && printf 'Next: %s\n' "$2" >&2; exit 1; }
step() { printf '\n== %s\n' "$1"; }

build_checks() {
  local names="$*" attrs=() c
  for c in "$@"; do attrs+=(".#checks.$system.$c"); done
  if ! nix build --no-link -L "${attrs[@]}"; then
    fail "a nix check failed: $names (see the lines above for the first error)" \
      "run the failing one locally: nix build -L .#checks.$system.<name>; for tests-<name> that is bun test in extensions/<name>, for types it is tsc, for pre-commit it is just lint"
  fi
}

run_compat() {
  step "released extensions against the current shared/"
  nix develop --command scripts/compat.sh ||
    fail "compat failed: a tagged extension no longer passes its tests against the current shared/" \
      "keep shared/ backward compatible (add, do not change), or bump the extension in the same release"
}

case "$mode" in
  pr | main) ;;
  *) fail "unknown mode $mode" "use: ci-checks.sh pr BASE_SHA | ci-checks.sh main BASE_SHA" ;;
esac
base="${2:?ci-checks.sh needs BASE_SHA}"
git rev-parse -q --verify "$base^{commit}" >/dev/null || fail "base commit $base is not in this checkout" "checkout needs fetch-depth: 0"
before="$base"
range="$base..HEAD"
if [ "$mode" = pr ]; then
  before="$(git merge-base "$base" HEAD)" || fail "no common commit for $base and HEAD" "fetch the full branch history"
  range="$base...HEAD"
  step "commit subjects since $base"
  scripts/check-branch-msgs.sh "$base" || fail "a commit on this branch has a subject without <scope>:" \
    "reword it (git rebase -i $base) and push again; the scopes are listed above"
fi
changed="$(git diff --name-only --no-renames "$range")" || fail "cannot read changed files for $range" "check the base commit and repository history"
if [ -z "$changed" ]; then
  [ "$mode" = main ] || fail "$range changes no files" "check the base commit or close the empty PR"
  echo "ci: no file changes; checks skipped"
  exit 0
fi

checks=(pre-commit)
all=false
compat=false
code=false
while IFS= read -r file; do
  case "$file" in
    docs/*.md | README.md | AGENTS.md | CONTRIBUTING.md | SECURITY.md | CHANGELOG.md | shared/README.md | shared/AGENTS.md | shared/CHANGELOG.md) ;;
    extensions/*/*)
      name="${file#extensions/}"
      name="${name%%/*}"
      case "${file#extensions/"$name"/}" in README.md | AGENTS.md | CHANGELOG.md) continue ;; esac
      code=true
      if [ -d "extensions/$name" ]; then
        checks+=(types tests-integration "tests-$name")
      else
        all=true
      fi
      ;;
    integration/*) code=true; checks+=(types tests-integration) ;;
    shared/* | package.json | flake.lock | flake.nix | nix/*) code=true; all=true; compat=true ;;
    *) code=true; all=true ;;
  esac
done <<<"$changed"

if ! $code; then
  step "documentation only: no tests"
  build_checks pre-commit
  exit 0
fi

# A version field on the same line as a dependency change must not hide that change.
release=true
manifest=false
while IFS= read -r file; do
  case "$file" in
    README.md | CHANGELOG.md | shared/README.md | shared/CHANGELOG.md) ;;
    extensions/*/README.md | extensions/*/CHANGELOG.md)
      if [[ ! "$file" =~ ^extensions/[^/]+/(README|CHANGELOG)\.md$ ]]; then release=false; break; fi
      ;;
    package.json | */package.json)
      if [[ ! "$file" =~ ^(package\.json|shared/package\.json|extensions/[^/]+/package\.json)$ ]]; then release=false; break; fi
      manifest=true
      added_or_deleted="$(git diff --name-only --diff-filter=AD --no-renames "$range" -- "$file")" ||
        fail "cannot check manifest changes for $file" "check the repository history"
      if [ -n "$added_or_deleted" ]; then release=false; break; fi
      old="$(git show "$before:$file" | jq -S 'del(.version)')" ||
        fail "cannot read $file at $before" "fix the manifest or fetch the missing commit"
      new="$(jq -S 'del(.version)' "$file")" || fail "cannot read $file at HEAD" "fix the manifest JSON"
      if [ "$old" != "$new" ]; then release=false; break; fi
      ;;
    *) release=false; break ;;
  esac
done <<<"$changed"
if $release && $manifest; then
  step "release: versions, changelogs and README blocks"
  build_checks pre-commit
  nix develop --command scripts/release-check.sh ||
    fail "release-check failed: an extension changed since its tag without a new version, or a README changelog block is stale" \
      "run just bump-changed (or just notes) on main again and update this PR"
  exit 0
fi

if $all; then
  step "shared code, build inputs or unclassified files: every nix check"
  names="$(nix eval --json ".#checks.$system" --apply builtins.attrNames | jq -r '.[]')" ||
    fail "cannot list Nix checks for $system" "run nix eval .#checks.$system --apply builtins.attrNames locally"
  [ -n "$names" ] || fail "the flake has no checks for $system" "add checks to flake.nix"
  mapfile -t checks <<<"$names"
else
  names="$(printf '%s\n' "${checks[@]}" | sort -u)" || fail "cannot sort selected checks" "check that sort is available"
  mapfile -t checks <<<"$names"
fi
step "selected checks: ${checks[*]}"
build_checks "${checks[@]}"
if $compat; then
  run_compat
else
  echo "compatibility inputs unchanged: compat skipped"
fi
echo "ci: all checks passed"
