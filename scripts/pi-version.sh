#!/usr/bin/env bash
# The tests and types use the pi of the llm-agents input in flake.lock; fail when the installed pi is another version.
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { printf 'pi-version: %s\nNext: %s\n' "$1" "$2" >&2; exit 1; }
[ -n "${PI_VERSION:-}" ] || fail "PI_VERSION is not set" "run inside the dev shell: nix develop, or direnv allow"
command -v pi >/dev/null || fail "pi is not installed" "install pi, or run the tests without the version check: bun test"
installed="$(pi --version 2>&1 | tail -n1)"
[ "$installed" = "$PI_VERSION" ] ||
  fail "the tests use pi $PI_VERSION (llm-agents in flake.lock), the installed pi is $installed" \
    "nix flake update llm-agents, then leave and enter the dev shell; if the installed pi is older, update the system first"
echo "pi-version: tests and installed pi are both $installed"
