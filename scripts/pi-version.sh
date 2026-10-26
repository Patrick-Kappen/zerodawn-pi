#!/usr/bin/env bash
# The tests and types use the pi of the llm-agents input in flake.lock; fail when the installed pi is another version.
# Reads the flake, not the environment: a shell or agent that started before a flake change has old values.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { printf 'pi-version: %s\nNext: %s\n' "$1" "$2" >&2; exit 1; }
command -v nix >/dev/null || fail "nix is not installed" "install nix; the dev shell and the tests come from flake.nix"
system="$(nix eval --raw --impure --expr builtins.currentSystem)"
shell=".#devShells.$system.default"
nix build --option warn-dirty false --no-link --quiet "$shell" || fail "cannot build the dev shell $shell" "fix flake.nix, then run again"
expected="$(nix eval --option warn-dirty false --raw "$shell.PI_VERSION")"
modules="$(nix eval --option warn-dirty false --raw "$shell.NODE_MODULES")"
if [ -e node_modules ] && [ ! -L node_modules ]; then
  fail "node_modules is a directory, not the link to pi's packages" "rm -rf node_modules"
fi
ln -sfn "$modules" node_modules
command -v pi >/dev/null || fail "pi is not installed" "install pi, or run the tests without the version check: bun test"
installed="$(pi --version 2>&1 | tail -n1)"
[ "$installed" = "$expected" ] ||
  fail "the tests use pi $expected (llm-agents in flake.lock), the installed pi is $installed" \
    "nix flake update llm-agents; if the installed pi is older, update the system first"
echo "pi-version: tests and installed pi are both $installed"
