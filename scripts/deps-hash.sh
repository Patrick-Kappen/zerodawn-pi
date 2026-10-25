#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sed -i 's|bunDepsHash = "sha256-[^"]*";|bunDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";|' flake.nix
git add flake.nix
got="$(nix build --no-link .#checks.x86_64-linux.types 2>&1 | sed -n 's/.*got: *\(sha256-[A-Za-z0-9+/=]*\).*/\1/p' | head -n1)"
[ -n "$got" ] || { echo "deps-hash: nix did not report a hash; run nix build .#checks.x86_64-linux.types -L" >&2; exit 1; }
sed -i "s|bunDepsHash = \"sha256-[^\"]*\";|bunDepsHash = \"$got\";|" flake.nix
echo "bunDepsHash = $got"
