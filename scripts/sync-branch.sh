#!/usr/bin/env bash
# Compare the repository behaviour with the sibling repository. Pass when the sibling main, or any sibling branch
# that is ahead of its main, has the same behaviour. The branch name does not matter.
# Runs as the pre-push hook. The local sibling next to this repository adds its unpushed branches, so both sides
# can be ready before the first push.
set -euo pipefail
cd "$(dirname "$0")/.."
# A git hook exports GIT_DIR and more; with them, "git -C <clone>" would act on this repository.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
sibling="$(sed -n 's/^sibling := "\(.*\)"$/\1/p' justfile)"
[ -n "$sibling" ] || { echo "sync-branch: no 'sibling := \"...\"' line in justfile" >&2; exit 2; }
url="https://github.com/Patrick-Kappen/$sibling.git"
local_repo="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/../.." && pwd)/$sibling"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
repo="$work/$sibling"

git clone -q --no-checkout "$url" "$repo" || {
  echo "sync-branch: cannot clone $url. Make sure you have access to it." >&2
  exit 2
}
if [ -d "$local_repo/.git" ]; then
  git -C "$repo" fetch -q "$local_repo" '+refs/heads/*:refs/remotes/local/*' || {
    echo "sync-branch: cannot read the branches of $local_repo." >&2
    exit 2
  }
fi

# A branch counts only when it is ahead of main; a merged or stale one would compare old code.
candidates=(origin/main)
while IFS= read -r ref; do
  git -C "$repo" merge-base --is-ancestor "$ref" origin/main || candidates+=("$ref")
done < <(git -C "$repo" for-each-ref --format='%(refname:short)' refs/remotes/origin refs/remotes/local |
  grep -vxE 'origin(/HEAD)?|origin/main|local/main')

for ref in "${candidates[@]}"; do
  git -C "$repo" checkout -q --detach "$ref"
  if scripts/sync-check.sh "$repo" >/dev/null 2>&1; then
    echo "sync-branch: same behaviour as $sibling $ref ($(git -C "$repo" rev-parse --short HEAD))"
    exit 0
  fi
done

git -C "$repo" checkout -q --detach origin/main
scripts/sync-check.sh "$repo" || true
echo "sync-branch: no branch of $sibling has the same repository behaviour (checked: ${candidates[*]})." >&2
echo "Next: make the same change in $sibling on any branch, commit it, then push again." >&2
exit 1
