# Run the unit tests
test:
    bun test

# Type-check all TypeScript
types:
    tsc

# Lint and check the format
lint:
    biome check .

# Format and apply safe lint fixes
fmt:
    biome check --write .
    nix fmt

# Run every check: lint, types, tests, nix
check: lint types test
    nix flake check

# Install the pinned pi types for tsc and the LSP
install:
    bun install --frozen-lockfile

# Start pi with these extensions in a tmux sandbox
dev:
    dev/pi-test.sh start

# Set the version in package.json and commit it; CI tags and releases it after the push: just bump 0.2.0
bump version:
    test -z "$(git status --porcelain)" || { echo "bump: commit or stash your changes first" >&2; exit 1; }
    jq --arg v "{{version}}" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
    biome format --write package.json
    git commit -q -m "release: v{{version}}" package.json
    @echo "committed v{{version}}; push main and CI creates the tag and the release"
