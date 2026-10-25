#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# section FILE N: the first N "## " sections of a changelog, without the title line
section() { awk -v n="$2" '/^## /{c++} c>=1 && c<=n' "$1"; }
# block FILE TEXT: replace the text between the changelog markers in FILE, or add the block at the end
block() {
  local file="$1" text="$2" tmp
  tmp="$(mktemp)"
  if grep -q '<!-- changelog:start -->' "$file"; then
    awk -v text="$text" '
      /<!-- changelog:start -->/ { print; print text; skip=1; next }
      /<!-- changelog:end -->/ { skip=0 }
      !skip' "$file" > "$tmp"
  else
    { cat "$file"; printf '\n## Changes\n\n<!-- changelog:start -->\n%s\n<!-- changelog:end -->\n' "$text"; } > "$tmp"
  fi
  mv "$tmp" "$file"
}
for manifest in shared/package.json extensions/*/package.json; do
  dir="$(dirname "$manifest")"
  [ -f "$dir/CHANGELOG.md" ] || printf '# Changelog\n' > "$dir/CHANGELOG.md"
  text="$(section "$dir/CHANGELOG.md" 1)"
  [ -n "$text" ] || text="No release yet."
  block "$dir/README.md" "$(printf '%s\n\n[All changes](CHANGELOG.md)' "$text")"
done
[ -f CHANGELOG.md ] || printf '# Changelog\n' > CHANGELOG.md
text="$(section CHANGELOG.md 3)"
[ -n "$text" ] || text="No release yet."
block README.md "$(printf '%s\n\n[All changes](CHANGELOG.md)' "$text")"
