#!/usr/bin/env bash
# Check the subject of every commit that is not yet on origin/main. Runs as the pre-push hook and in CI.
set -euo pipefail
cd "$(dirname "$0")/.."
base="${1:-origin/main}"
git rev-parse -q --verify "$base" >/dev/null || { echo "check-branch-msgs: $base does not exist; fetch first" >&2; exit 2; }
status=0
while IFS= read -r sha; do
  scripts/check-commit-msg.sh -m "$(git log -1 --format=%B "$sha")" || { echo "  in commit $(git log -1 --format=%h "$sha")" >&2; status=1; }
done < <(git rev-list --no-merges "$base..HEAD")
[ $status -eq 0 ] && echo "check-branch-msgs: every commit since $base has a valid subject"
exit $status
