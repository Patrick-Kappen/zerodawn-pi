sibling := "zerodawn-pi-private"

# Run all tests with the installed pi version
test: pi-version
    bun test

# Test contracts between extensions and release scripts
test-integration: pi-version
    bun test ./integration

# Run the tests for these changed files; run_tests calls it: just test-changed FILE...
test-changed *files: pi-version
    scripts/test-changed.sh {{files}}

# Link node_modules to the pi packages of flake.lock; fail when the installed pi is another version
pi-version:
    scripts/pi-version.sh

# Type-check all TypeScript
types: pi-version
    tsc

# Lint and check the format
lint:
    biome check --error-on-warnings .
    shellcheck scripts/*.sh

# Write the pre-commit config of the flake to .pre-commit-config.yaml; the check hooks-config fails until it matches
hooks-config:
    install -m 644 "$(nix build --option warn-dirty false --no-link --print-out-paths .#checks.x86_64-linux.pre-commit.config.configFile)" .pre-commit-config.yaml

# Format and apply safe lint fixes
fmt:
    biome check --write .
    nix fmt --option warn-dirty false

# Run every check: lint, types, tests, nix (nix flake check includes tsc and the tests per extension)
check: lint types test
    nix flake check --option warn-dirty false

# Run the tests of every extension's last released version against the current shared/ and package.json
compat:
    scripts/compat.sh

# Bump every extension that changed since its last tag, and the package; the level comes from the "Change:" trailers
bump-changed legacy="":
    scripts/bump-changed.sh {{legacy}}

# Fail when an extension changed since its last tag without a higher version; CI runs this on a release PR
release-check:
    scripts/release-check.sh

# Show check results that did not help the agent, from the pi sessions since a date (default: 7 days ago)
check-findings since="":
    bun extensions/bash/tool/findings.ts {{since}}

# Write the changelog blocks into the README of each extension and the root README
notes:
    scripts/notes.sh

# Fail when the repository behaviour (CI, scripts, flake checks, dev shell, justfile) differs from the sibling repository
sync-check other=("../" + sibling):
    scripts/sync-check.sh {{other}}

# Set a version and commit it; CI tags it after the push. Package: just bump 0.3.0. Extension: just bump 0.2.0 bash
bump version extension="":
    scripts/bump.sh {{version}} {{extension}}

# Start pi with all extensions in a detached tmux session, in a sandbox project; PI_TEST_ARGS adds pi arguments, PI_DEV=<name> a separate session
dev:
    scripts/dev.sh

# Stop the sandbox session
dev-stop:
    scripts/dev.sh stop

# Show the sandbox screen
dev-screen:
    scripts/dev.sh screen

# Type text into the sandbox and press enter: just dev-send "ls"
dev-send text:
    scripts/dev.sh send "{{text}}"

# Send a tmux key to the sandbox: just dev-key C-c
dev-key key:
    scripts/dev.sh key "{{key}}"
