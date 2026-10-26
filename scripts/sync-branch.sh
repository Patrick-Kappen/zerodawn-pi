#!/usr/bin/env bash
# Compare the repository behaviour with the sibling repository, on the branch of the same name when it is ahead of
# its main, else on main. Runs as the pre-push hook and in CI.
# The pre-push hook takes the sibling branch from the local sibling repository next to this one, so both branches
# can be ready before the first push. CI has no local sibling and takes it from GitHub.
# Usage: sync-branch.sh [BRANCH]; default: the current branch.
set -euo pipefail
cd "$(dirname "$0")/.."
# A git hook exports GIT_DIR and more; with them, "git -C <clone>" would act on this repository.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
sibling="$(sed -n 's/^sibling := "\(.*\)"$/\1/p' justfile)"
[ -n "$sibling" ] || { echo "sync-branch: no 'sibling := \"...\"' line in justfile" >&2; exit 2; }
url="https://github.com/Patrick-Kappen/$sibling.git"
local_repo="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/../.." && pwd)/$sibling"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A branch counts only when it is ahead of main; a merged or stale one would compare old code.
ahead() { git -C "$1" rev-parse -q --verify "$2" >/dev/null && ! git -C "$1" merge-base --is-ancestor "$2" "$3"; }

if [ -d "$local_repo/.git" ] && ahead "$local_repo" "refs/heads/$branch" refs/heads/main; then
  source="local $local_repo"
  git clone -q --no-checkout "$local_repo" "$work/$sibling"
else
  source="$url"
  git clone -q --no-checkout "$url" "$work/$sibling" || {
    echo "sync-branch: cannot clone $url. Make sure you have access to it." >&2
    exit 2
  }
fi
ref=main
ahead "$work/$sibling" "origin/$branch" origin/main && ref="$branch"
git -C "$work/$sibling" checkout -q "origin/$ref"
echo "sync-branch: comparing with $sibling@$ref ($(git -C "$work/$sibling" rev-parse --short HEAD)) from $source"
scripts/sync-check.sh "$work/$sibling" || {
  echo "sync-branch: the repository behaviour differs from $sibling@$ref (details above)." >&2
  echo "Next: make the same change in $sibling on a branch named '$branch', commit it, then push again." >&2
  exit 1
}
