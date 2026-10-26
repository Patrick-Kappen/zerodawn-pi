sibling := "zerodawn-pi-private"

# Run the unit tests, after a check that they use the installed pi version
test: pi-version
    bun test

# Fail when the pi of flake.lock (used by tests and types) is not the installed pi
pi-version:
    scripts/pi-version.sh

# Type-check all TypeScript
types:
    tsc

# Lint and check the format
lint:
    biome check .
    shellcheck scripts/*.sh

# Format and apply safe lint fixes
fmt:
    biome check --write .
    nix fmt

# Run every check: lint, types, tests, nix (nix flake check includes tsc and the tests per extension)
check: lint types test
    nix flake check

# Run the tests of every extension's last released version against the current shared/ and package.json
compat:
    scripts/compat.sh

# Bump every extension that changed since its last tag, and the package: just bump-changed minor|patch|major
bump-changed level="minor":
    scripts/bump-changed.sh {{level}}

# Fail when an extension changed since its last tag without a higher version; CI runs this on a release PR
release-check:
    scripts/release-check.sh

# Write the changelog blocks into the README of each extension and the root README
notes:
    scripts/notes.sh

# Fail when the repository behaviour (CI, scripts, flake checks, dev shell, justfile) differs from the sibling repository
sync-check other=("../" + sibling):
    scripts/sync-check.sh {{other}}

# Set a version and commit it; CI tags it after the push. Package: just bump 0.3.0. Extension: just bump 0.2.0 bash
bump version extension="":
    scripts/bump.sh {{version}} {{extension}}

# Start pi with all extensions in a detached tmux session, in a sandbox project; PI_TEST_ARGS adds pi arguments
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
