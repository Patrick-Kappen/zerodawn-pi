#!/usr/bin/env bash
# After a merge to main: tag every new version and create the GitHub release. Needs GH_TOKEN and push rights.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { printf 'ci-release: %s\n' "$1" >&2; [ $# -gt 1 ] && printf 'Next: %s\n' "$2" >&2; exit 1; }
[ -n "${GH_TOKEN:-}" ] || fail "GH_TOKEN is not set" "the release job needs the GitHub token with contents: write"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git fetch -q --tags origin || fail "cannot fetch tags from origin" "check the token and the remote"

# section FILE VERSION: the changelog section of VERSION, without its heading.
section() { awk -v v="$2" '/^## /{p=($2==v)} p && !/^## /' "$1"; }
tag_it() {
  local tag="$1" notes="$2"
  git tag -a "$tag" -m "$tag" -m "$notes" || fail "cannot create tag $tag" "does it exist with another case or on another commit? git tag -l '$tag*'"
  git push origin "$tag" || fail "cannot push tag $tag" "check branch protection and the token scope (contents: write)"
  echo "tagged $tag"
}

tagged=0
for manifest in shared/package.json extensions/*/package.json; do
  name="$(jq -r .name "$manifest")" || fail "$manifest is not valid JSON" "fix it and merge again"
  version="$(jq -r .version "$manifest")"
  [ "$version" != "null" ] || fail "$manifest has no version" "add one; nix flake check should have caught this"
  tag="$name-v$version"
  git rev-parse -q --verify "refs/tags/$tag" >/dev/null && continue
  notes="$(section "$(dirname "$manifest")/CHANGELOG.md" "$version")"
  [ -n "$notes" ] || fail "$(dirname "$manifest")/CHANGELOG.md has no section '## $version'" \
    "the release PR must come from just bump-changed, which writes it; add the section and tag by hand: git tag -a $tag"
  tag_it "$tag" "$notes"; tagged=$((tagged+1))
done

version="$(jq -r .version package.json)"; tag="v$version"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag exists: no package release ($tagged new component tags)"
  exit 0
fi
notes="$(section CHANGELOG.md "$version")"
[ -n "$notes" ] || fail "CHANGELOG.md has no section '## $version'" \
  "the release PR must come from just bump-changed; add the section, then rerun this job"
tag_it "$tag" "$notes"
gh release create "$tag" --title "$tag" --notes "$notes" ||
  fail "tag $tag is pushed but the GitHub release was not created" "create it by hand with the section of CHANGELOG.md: gh release create $tag --title $tag --notes-file FILE"
echo "released $tag with $tagged component tags"
