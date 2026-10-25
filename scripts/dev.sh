#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX=/tmp/pi-sandbox
SESSION=pi-dev
MODEL="${PI_TEST_MODEL:-anthropic/claude-sonnet-5-5}"
case "${1:-start}" in
  stop) exec tmux kill-session -t "${SESSION}" ;;
  screen) exec tmux capture-pane -t "${SESSION}" -p -e ;;
  send) tmux send-keys -t "${SESSION}" -l -- "${2:?text}"; exec tmux send-keys -t "${SESSION}" Enter ;;
  key) exec tmux send-keys -t "${SESSION}" "${2:?key}" ;;
  start) ;;
  *) echo "usage: dev.sh [start|stop|screen|send TEXT|key KEY]" >&2; exit 2 ;;
esac
mkdir -p "${SANDBOX}" && cd "${SANDBOX}"
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
if tmux has-session -t ${SESSION} 2>/dev/null; then
  echo "session ${SESSION} already runs; attach with: tmux attach -t ${SESSION}"
  exit 0
fi
tmux new-session -d -s ${SESSION} -x 160 -y 45 -c ${SANDBOX}
exts=""
for index in "$root"/extensions/*/index.ts; do exts="$exts -e '$index'"; done
tmux send-keys -t ${SESSION} -l -- "pi -ne -e builtin:codemode$exts --model '${MODEL}' ${PI_TEST_ARGS:-}"
tmux send-keys -t ${SESSION} Enter
echo "started session ${SESSION} in ${SANDBOX}; attach with: tmux attach -t ${SESSION}"
