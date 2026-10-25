# Plan: pi package `zerodawn-pi`

One local pi package with independent extensions. Pi is the core: it loads, toggles and reloads them.
Development and test here. Deployment later from nixos-config as one fixed path `~/.pi/agent/packages/zerodawn`.

## Layout

```
package.json          name zerodawn-pi, keywords ["pi-package"], pi.extensions ["*/index.ts", "stall-watchdog.ts"]
shared/               util.ts, store.ts. No index.ts, so not an extension.
bash-jobs/            bash tool in a PTY, jobs, dashboard widget, log viewer, renderers
git-tool/             git tool and the bash guard for git status/diff/log/show
recipes/              justfile and Makefile recipes, test repeat check
builtins/             read, grep, edit, write with own descriptions, indent fix, write guard
ext-switch/           /ext: enable or disable extensions, builtins, skills, prompts, themes in the session
dev/pi-test.sh        pi in a tmux session with a sandbox project
```

Rules for all code:
- Each extension imports only from its own directory and `shared/`. No import from another extension.
- Fail loud. No fallback that hides a missing input.
- Tests with `bun test` next to the code (`*.test.ts`).
- Constants in one `config.ts` per extension. No settings UI.

## Work packages

Each work package owns a set of files. Two packages never write the same file. `index.ts` wiring is done last by the main session.

### WP0 Restructure (main session)

Rename `tool-output/` to `bash-jobs/`. Add `package.json`, `shared/util.ts`, `shared/store.ts`. Update `dev/pi-test.sh` to load every `*/index.ts`.

### WP1 Renderer `bash-jobs/screen.ts` (+ `screen.test.ts`)

Pure module, no pi imports. Turns a raw PTY byte stream into terminal lines as a terminal shows them.

API:
- `class Screen { feed(chunk: string): void; lines(): string[]; plain(): string[] }`
- `lines()` keeps SGR colors. Each line is self-contained: the active SGR state is re-emitted at the start of a line, and a reset ends it.
- `plain()` strips all escapes (for the model and for tests).
- `stripScript(text): { body: string; exitCode?: number }` removes the `script` header line (`Script started on …`) and footer (`Script done on … [COMMAND_EXIT_CODE="n"]`) and reads the exit code.

Handles: `\r` (overwrite from column 0), `\n`, `\b`, `\t` (8-column stops), CSI `K` (0, 1, 2), CSI `A`/`B` (cursor up/down inside the buffer), CSI `G`, CSI `C`/`D`, CSI `J` (2 and 3: clear buffer), CSI `?25l/h` and other private modes (ignore), OSC (`ESC ]` … `BEL` or `ST`), charset `ESC ( B`, `ESC =`/`ESC >`. Unknown CSI: drop. Wide characters: count with `visibleWidth` from `@earendil-works/pi-tui` only in callers; the renderer counts columns per code point.

Tests: fixtures recorded with `script` in the sandbox (`progress.sh`, `just test`, `nix build`, `git clone`), plus unit cases per escape.

### WP2 Job runner (`bash-jobs/bash.ts`, `jobproc.ts`, `jobs.ts`, `state.ts`, `config.ts`)

- Spawn `script -q -e -f -E never -O <log> -c <wrapper>` detached. The wrapper sets `stty cols <width> rows <height>` from the pi terminal size, applies the time limit, and writes the exit code to `<id>.status`.
- Every call is a job from the start: id, log, meta json, start time. The dashboard shows it at once.
- Foreground wait `FOREGROUND_MS = 30_000`. After that, or with `background: true`, or on `ctrl+shift+b`, the call returns `job <id> runs in the background; a message reports the result` and the result comes as a `bash-job` message.
- While in the foreground, `onUpdate` every 250 ms with the last `STREAM_LINES = 40` rendered lines.
- Inline result up to pi's limit (`DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES` from `@earendil-works/pi-coding-agent`, 50 KB / 2000 lines) with `truncateTail`. Model text: `exit 0 (1.2s)` + plain output. Truncated: `exit 0 · 412 lines · last 2000 lines:` + tail + `log: <path>`. Error: status + last 50 lines.
- Keep: resume after restart (exit code from `.status` or the `script` footer), groups, report confirmation and resend, kill on quit, `/jobs`, `jobs` tool, `sleep`/poll block while a background job runs.
- Remove: the 2000 byte / 40 line inline limit.

### WP3 Dashboard and renderers (`bash-jobs/dashboard.ts`, `icons.ts`, `render.ts`, `jobview.ts`; delete `widget.ts`)

- Widget `aboveEditor`, one key. Data: `tool_execution_start/update/end` for all tools (nested calls with `parentToolCallId` as child rows) plus the job registry.
- Counts per turn, reset on `agent_start`: running, done, failed, elapsed.
- Collapsed: one line. Expanded (`alt+h` or click): one row per call with Nerd Font icon, tool, argument summary, elapsed, `⇡bg`; under a running bash row the last 3 rendered lines, live (tick 250 ms while something runs).
- Ended rows stay `ENDED_MS = 10_000`, then fold into the counts. Background jobs stay until their report is confirmed.
- Empty widget (0 lines) when idle with no jobs.
- Click on a bash row or `ctrl+shift+j`: full viewer (`jobview.ts`) with scroll, follow, colors from `screen.ts`.
- `render.ts`: `renderCall` for bash (`$ <command>`), `renderResult` (one line; expanded: rendered output up to 200 lines, then `… N more lines · ctrl+shift+j`; `isPartial` streams), message renderer for `bash-job` (one line per job; expanded: output tail).
- Icons in `icons.ts`, one table: tool name → glyph, with status glyphs `●` `✓` `✗` `■`.

### WP4 Split (`git-tool/`, `recipes/`, `builtins/`)

Move without behavior change:
- `git.ts` + the git part of `guard.ts` → `git-tool/`.
- `recipes.ts` + the tracker parts of `limits.ts` → `recipes/`. The "command ran 3 times" block becomes a hint in the result.
- `builtins.ts`, `editfix.ts`, the write guard and the codemode truncation (raised to pi's limit) → `builtins/`.
- Remove: the read block, the `limit` cap, the grep default of 30, the `cat/head/tail/sed -n` block.
- Tests move with the code. `bun test` green in every directory.

### WP5 `/ext` (`ext-switch/`)

- Research first: how `pi config` writes `settings.json` (read pi's bundled config command). Use the same format.
- `/ext`: list of builtins, loose extensions (user and project dirs), package extensions, skills, prompts, themes. Each with state and the scope that sets it. Toggle with key or click; `Tab` switches scope (user `~/.pi/agent/settings.json` with `PI_CODING_AGENT_DIR`, project `<cwd>/.pi/settings.json`).
- `/ext list`, `/ext on <name>`, `/ext off <name>`.
- Write atomically (tmp + rename), touch only the changed keys, then `await ctx.reload()`. Read the state again from the files after reload.
- `/ext` does not disable itself. MCP servers stay with `/mcp`.
- Errors: unreadable settings, unknown name, write failure → message with path and cause.

### WP6 Integration (main session, after a decision on tidy-ui)

- `tidy-ui/working.ts`: keep `Thinking…`/`Writing…`, drop tool names (pending decision).
- nixos-config: `packages/agents/pi/` installs this package at `~/.pi/agent/packages/zerodawn`; `settings.json` gets `packages: ["~/.pi/agent/packages/zerodawn"]` once by hand. Remove the five extension symlinks.

### WP7 Manual test (tmux, sonnet)

`dev/pi-test.sh start`, then: `ls` of 62 lines (inline); `./progress.sh` (expanded, streaming, colors); `just slow` (background after 30 s, report message); three bash calls in one message; `ctrl+shift+b`; restart pi with a running job; codemode with nested calls; an MCP tool; `/ext off recipes` and back; window of 80 columns.

## Order

WP0 → WP1 → (WP2, WP3, WP4, WP5 in parallel) → wiring and `bun test` → WP7 → WP6.
