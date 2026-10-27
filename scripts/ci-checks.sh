#!/usr/bin/env bash
# The checks CI runs. Usage: ci-checks.sh pr BASE_SHA | ci-checks.sh main
# Every failure prints what failed, where, and the next step; the exit code is 1.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:?usage: ci-checks.sh pr BASE_SHA | ci-checks.sh main}"
system=x86_64-linux

fail() { printf 'ci: %s\n' "$1" >&2; [ $# -gt 1 ] && printf 'Next: %s\n' "$2" >&2; exit 1; }
step() { printf '\n== %s\n' "$1"; }

build_checks() {
  local names="$1" attrs=() c
  for c in $names; do attrs+=(".#checks.$system.$c"); done
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
  main)
    step "all nix checks"
    nix flake check -L || fail "nix flake check failed on main (see above for the first failing check)" \
      "run nix flake check -L locally; main is broken until the fix is merged"
    run_compat
    ;;
  pr)
    base="${2:?ci-checks.sh pr needs BASE_SHA}"
    git rev-parse -q --verify "$base" >/dev/null || fail "base commit $base is not in this checkout" "checkout needs fetch-depth: 0"
    step "commit subjects since $base"
    scripts/check-branch-msgs.sh "$base" || fail "a commit on this branch has a subject without <scope>:" \
      "reword it (git rebase -i $base) and push again; the scopes are listed above"

    changed="$(git diff --name-only "$base...HEAD")"
    [ -n "$changed" ] || fail "the PR changes no files" "nothing to check; close the PR or push a change"

    # A release PR changes only versions, changelogs and READMEs; the code was tested when it merged.
    if ! printf '%s\n' "$changed" | grep -qvE '(^|/)(package\.json|CHANGELOG\.md|README\.md)$' &&
       ! git diff "$base...HEAD" -- package.json '*/package.json' | grep -E '^[+-] ' | grep -qv '"version"'; then
      step "release PR: versions, changelogs and README blocks"
      build_checks pre-commit
      nix develop --command scripts/release-check.sh ||
        fail "release-check failed: an extension changed since its tag without a new version, or a README changelog block is stale" \
          "run just bump-changed (or just notes) on main again and update this PR"
      exit 0
    fi

    if printf '%s\n' "$changed" | grep -qv '^extensions/'; then
      step "files outside extensions/ changed: every nix check"
      checks="$(nix eval --json ".#checks.$system" --apply builtins.attrNames 2>/tmp/eval.err | jq -r '.[]' | tr '\n' ' ')" ||
        fail "the flake does not evaluate: $(tail -n 3 /tmp/eval.err | tr '\n' ' ')" "run nix eval .#checks.$system --apply builtins.attrNames locally"
      [ -n "$checks" ] || fail "the flake has no checks for $system" "nix eval .#checks.$system --apply builtins.attrNames"
    else
      checks="pre-commit hooks-config types"
      for name in $(printf '%s\n' "$changed" | grep '^extensions/' | cut -d/ -f2 | sort -u); do
        [ -d "extensions/$name" ] || fail "extensions/$name was removed or renamed in this PR" \
          "a rename needs a note in docs/decisions.md and a release; run the full checks with a change outside extensions/"
        checks="$checks tests-$name"
      done
      step "changed extensions: $checks"
    fi
    build_checks "$checks"

    if git diff --quiet "$base...HEAD" -- shared package.json flake.lock; then
      echo "shared/ unchanged: compat skipped"
    else
      run_compat
    fi
    ;;
  *) fail "unknown mode $mode" "use: ci-checks.sh pr BASE_SHA | ci-checks.sh main" ;;
esac
echo "ci: all checks passed"
