#!/usr/bin/env bash
# Check one commit message: "<scope>: <subject>" where scope is an extension, shared, or an area.
# Usage: check-commit-msg.sh FILE (git commit-msg hook) or check-commit-msg.sh -m "message".
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ ${1-} == "-m" ]]; then message="${2-}"; else message="$(cat "$1")"; fi
subject="$(printf '%s\n' "$message" | grep -v '^#' | head -n1)"

case "$subject" in
  "Merge "*|"Revert "*|"fixup! "*|"squash! "*) exit 0 ;;
esac

scopes=(shared release ci docs flake repo deps)
for dir in "$root"/extensions/*/; do scopes+=("$(basename "$dir")"); done

scope="${subject%%:*}"
rest="${subject#*:}"
ok=0
for s in "${scopes[@]}"; do [[ $scope == "$s" ]] && ok=1; done

if [[ $subject != *": "* || $ok -eq 0 || -z ${rest# } ]]; then
  printf 'commit message: the subject must be "<scope>: <what changed>", scope one of: %s\n  got: %s\n' "${scopes[*]}" "$subject" >&2
  exit 1
fi
if [[ ${#subject} -gt 72 ]]; then
  printf 'commit message: the subject has %d characters; keep it at 72\n' "${#subject}" >&2
  exit 1
fi
