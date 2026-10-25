#!/usr/bin/env bash
# Start pi with this extension in a detached tmux session, in a sandbox project.
# Usage: dev/pi-test.sh [start|stop|screen|send <text>|key <tmux-key>]
# PI_TEST_MODEL sets the model; PI_TEST_ARGS adds pi arguments, for example "-e ~/.pi/agent/extensions/x/index.ts".
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
sandbox=/tmp/pi-sandbox
session=pi-dev
model="${PI_TEST_MODEL:-anthropic/claude-sonnet-5-5}"

fixtures() {
  mkdir -p "$sandbox"
  cd "$sandbox"
  if [ ! -d .git ]; then git init -q; fi
  seq 1 1000 | sed 's/^/line /' > big.txt
  seq 1 3000 | sed 's/^/noise /' > noise.txt
  cat > progress.sh <<'EOF'
#!/usr/bin/env bash
# Colored progress bar that overwrites its line, then a multi-line status.
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
  cat > README.md <<'EOF'
# Sandbox

Fixtures for the zerodawn-pi extensions: big.txt (1000 lines), noise.txt (3000 lines),
progress.sh (colored progress bar), justfile (test: 3 s, slow: 60 s).
EOF
}

case "${1:-start}" in
  start)
    fixtures
    if tmux has-session -t "$session" 2>/dev/null; then
      echo "session $session already runs; attach with: tmux attach -t $session"
      exit 0
    fi
    tmux new-session -d -s "$session" -x 160 -y 45 -c "$sandbox"
    exts=""
    for index in "$root"/extensions/*/index.ts; do exts="$exts -e '$index'"; done
    tmux send-keys -t "$session" -l -- "pi -ne -e builtin:codemode$exts --model '$model' ${PI_TEST_ARGS:-}"
    tmux send-keys -t "$session" Enter
    echo "started session $session in $sandbox; attach with: tmux attach -t $session"
    ;;
  stop)
    tmux kill-session -t "$session"
    ;;
  screen)
    tmux capture-pane -t "$session" -p -e
    ;;
  send)
    shift
    tmux send-keys -t "$session" -l -- "$*"
    tmux send-keys -t "$session" Enter
    ;;
  key)
    shift
    tmux send-keys -t "$session" "$@"
    ;;
  *)
    echo "pi-test.sh: unknown action '$1'. Use start, stop, screen, send <text> or key <tmux-key>." >&2
    exit 1
    ;;
esac
