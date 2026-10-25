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

sandbox := "/tmp/pi-sandbox"
session := "pi-dev"
model := env("PI_TEST_MODEL", "anthropic/claude-sonnet-5-5")

# Start pi with all extensions in a detached tmux session, in a sandbox project; PI_TEST_ARGS adds pi arguments
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p {{sandbox}} && cd {{sandbox}}
    [ -d .git ] || git init -q
    seq 1 1000 | sed 's/^/line /' > big.txt
    seq 1 3000 | sed 's/^/noise /' > noise.txt
    cat > progress.sh <<'EOF'
    #!/usr/bin/env bash
    for i in $(seq 1 20); do
      printf '\r\e[32m[%-20s]\e[0m %3d%%' "$(printf '#%.0s' $(seq 1 "$i"))" $((i * 5))
      sleep 0.4
    done
    printf '\n\e[1mdone\e[0m\n'
    printf 'step 1\nstep 2\n\e[1A\e[2Kstep 2 (fixed)\n'
    EOF
    chmod +x progress.sh
    cat > justfile <<'EOF'
    # Run the tests
    test:
        sleep 3
        echo "41 passed"

    # Run a 20 s job
    medium:
        for i in $(seq 1 20); do echo "tick $i"; sleep 1; done

    # Run a long job
    slow:
        for i in $(seq 1 60); do echo "tick $i"; sleep 1; done
    EOF
    if tmux has-session -t {{session}} 2>/dev/null; then
      echo "session {{session}} already runs; attach with: tmux attach -t {{session}}"
      exit 0
    fi
    tmux new-session -d -s {{session}} -x 160 -y 45 -c {{sandbox}}
    exts=""
    for index in "{{justfile_directory()}}"/extensions/*/index.ts; do exts="$exts -e '$index'"; done
    tmux send-keys -t {{session}} -l -- "pi -ne -e builtin:codemode$exts --model '{{model}}' ${PI_TEST_ARGS:-}"
    tmux send-keys -t {{session}} Enter
    echo "started session {{session}} in {{sandbox}}; attach with: tmux attach -t {{session}}"

# Stop the sandbox session
dev-stop:
    tmux kill-session -t {{session}}

# Show the sandbox screen
dev-screen:
    tmux capture-pane -t {{session}} -p -e

# Type text into the sandbox and press enter: just dev-send "ls"
dev-send text:
    tmux send-keys -t {{session}} -l -- "{{text}}"
    tmux send-keys -t {{session}} Enter

# Send a tmux key to the sandbox: just dev-key C-c
dev-key key:
    tmux send-keys -t {{session}} "{{key}}"

# Set the version in package.json and commit it; CI tags and releases it after the push: just bump 0.2.0
bump version:
    test -z "$(git status --porcelain)" || { echo "bump: commit or stash your changes first" >&2; exit 1; }
    jq --arg v "{{version}}" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
    biome format --write package.json
    git commit -q -m "release: v{{version}}" package.json
    @echo "committed v{{version}}; push main and CI creates the tag and the release"
