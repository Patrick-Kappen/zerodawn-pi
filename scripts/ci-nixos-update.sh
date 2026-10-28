#!/usr/bin/env bash
# After a package release: ask Patrick-Kappen/Nixos to update its input of this repository in one PR. Needs GH_TOKEN with write access to Nixos.
# Usage: ci-nixos-update.sh INPUT TAG
set -euo pipefail
fail() { printf 'ci-nixos-update: %s\n' "$1" >&2; [ $# -gt 1 ] && printf 'Next: %s\n' "$2" >&2; exit 1; }
[ $# -eq 2 ] || fail "usage: ci-nixos-update.sh INPUT TAG" "the release job passes the repository name and the package tag"
input="$1" tag="$2"
by_hand="gh workflow run pi-release.yml -R Patrick-Kappen/Nixos -f input=$input -f tag=$tag"
[ -n "${GH_TOKEN:-}" ] || fail "GH_TOKEN is not set: the secret NIXOS_UPDATE_TOKEN is missing" \
  "add it (contents write on Nixos), then run: $by_hand"
jq -n --arg input "$input" --arg tag "$tag" '{event_type: "pi-release", client_payload: {input: $input, tag: $tag}}' |
  gh api repos/Patrick-Kappen/Nixos/dispatches --input - ||
  fail "cannot send the pi-release event to Patrick-Kappen/Nixos" "check NIXOS_UPDATE_TOKEN, then run: $by_hand"
echo "asked Nixos to update $input to $tag"
