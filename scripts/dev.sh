#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# PI_DEV=<name> gives a separate tmux session and sandbox, so two testers do not share one pi.
suffix=""
if [ -n "${PI_DEV:-}" ]; then
  [[ "${PI_DEV}" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "dev.sh: PI_DEV='${PI_DEV}' is not a valid name; use letters, digits, - and _" >&2; exit 2; }
  suffix="-${PI_DEV}"
fi
SANDBOX="/tmp/pi-sandbox${suffix}"
SESSION="pi-dev${suffix}"
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
# A real test: a gate or run_tests in the sandbox must see a red test as red.
[ -f package.json ] || printf '{ "name": "sandbox", "type": "module" }\n' > package.json
printf 'export const sum = (a: number, b: number): number => a + b;\n' > sum.ts
cat > sum.test.ts <<'EOF'
import assert from "node:assert/strict";
import { test } from "node:test";
import { sum } from "./sum.ts";

test("sum adds two numbers", () => {
  assert.equal(sum(2, 3), 5);
});
EOF
cat > justfile <<'EOF'
# Run the tests
test:
    bun test

# Run a 20 s job
medium:
    for i in $(seq 1 20); do echo "tick $i"; sleep 1; done

# Run a long job
slow:
    for i in $(seq 1 60); do echo "tick $i"; sleep 1; done
EOF
if tmux has-session -t "${SESSION}" 2>/dev/null; then
  echo "session ${SESSION} already runs; attach with: tmux attach -t ${SESSION}"
  exit 0
fi
# The sandbox uses the config of the installed package, so it gets the same login extensions as the user's pi.
config="${HOME}/.pi/agent/packages/$(jq -r .name "$root/package.json")/config.json"
[ -f "$config" ] || { echo "dev.sh: $config does not exist; install the package with the Home Manager module first" >&2; exit 1; }
exts=""
for index in "$root"/extensions/*/index.ts; do exts="$exts -e '$index'"; done
if ! jq -e '.subagentExtensions | type == "array"' "$config" >/dev/null; then
  echo "dev.sh: $config has no subagentExtensions list; set the Home Manager option subagentExtensions" >&2
  exit 1
fi
while IFS= read -r index; do
  [ -f "$index" ] || { echo "dev.sh: $index from subagentExtensions in $config does not exist" >&2; exit 1; }
  exts="$exts -e '$index'"
done < <(jq -r '.subagentExtensions[]' "$config")
tmux new-session -d -s "${SESSION}" -x 160 -y 45 -c "${SANDBOX}"
tmux send-keys -t "${SESSION}" -l -- "ZERODAWN_PI_CONFIG='$config' pi -ne -e builtin:codemode$exts --model '${MODEL}' ${PI_TEST_ARGS:-}"
tmux send-keys -t "${SESSION}" Enter
echo "started session ${SESSION} in ${SANDBOX}; attach with: tmux attach -t ${SESSION}"
