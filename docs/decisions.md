# Decisions

Short records of choices that shape the repository. Newest at the top.

## 9. Subagents run as pi processes in tmux, owned by a supervisor (2026-10-26)

The `subagents` extension starts each subagent as a normal interactive pi in a window of a detached tmux session `pi-sub-<first 8 characters of the pi session id>`, one session per main agent. The user can attach and watch the real pi UI, and a hung subagent cannot block the main pi. A supervisor in window 0 owns the subagents; the main pi and the subagents are clients of its Unix socket. Reason: neither agent owns the lifecycle, so a subagent can finish after the main pi stops, and a 2 hour timer cleans up after a crash. Runtime state and subagent sessions go to `/tmp/pi-sub-<id>/`, so a reboot removes them. The supervisor runs under the runtime of pi (`process.execPath`), so it needs no extra dependency. No shell scripts and no `tmux send-keys`. Rejected: the SDK inside the main pi process (no own UI, a hang blocks the main agent), and `--mode json` or `--mode rpc` in tmux (the pane shows JSON, not the pi UI).

## 8. Release workflow: feature PRs do not bump, one release PR bumps what changed (2026-10-25)

Feature PRs merge continuously. `just bump-changed` bumps every extension that changed since its last tag, and the package, and writes the changelog sections from the commit subjects. CI runs `release-check` only on a PR that changes the package version, and tags only on its merge. Reason: several PRs can land between releases without version conflicts, and the tags still mark what was tested together.

## 7. Changelog from commit subjects (2026-10-25)

A commit subject starts with the extension name (`bash: …`). The changelog per extension and the root changelog are generated from those subjects at release time and can be edited in the release PR. Reason: no manual changelog work per PR, and the release notes stay complete.

## 6. Extension directories are named after what the user sees (2026-10-25)

`bash`, `git`, `files`, `opencode`, `ast-grep` for tools; `core` (`/ext`), `ui`, `tests`, `ctx-manager`, `systemstate`, `watchdog`, `gateway` for behaviour. Tool and command names inside pi do not change with a directory name.

## 5. A version per extension, one release unit (2026-10-25)

Every extension has a `package.json` with a version and gets a tag `<name>-v<version>`. The deploy unit stays the repository commit: one flake input, one lock. Per-extension versions mark what changed and drive `just compat`, which tests each extension's last release against the current `shared/`. Mixing versions of extensions in one install is not supported; `shared/` must stay backward compatible.

## 4. Every extension has tests, enforced by the flake (2026-10-25)

`nix flake check` has one derivation per extension (`tests-<name>`) with only that extension, `shared/` and the manifest as input, so an unchanged extension is a cache hit. The flake evaluation fails when an extension has no `package.json`, no version, or no `*.test.ts`.

## 3. Configuration comes from config.json, not from Nix placeholders (2026-10-25)

Extensions that need machine-specific values (`astGrep`, `nixosRepo`) read `config.json` next to `package.json`. The Home Manager module generates that file into the package. Without Nix, the user writes it by hand. Reason: one mechanism for both, no `@placeholder@` left in a plain checkout, and a wrong value fails with the file path.

## 2. settings.json is merged, not managed (2026-10-25)

pi and `/ext` write `~/.pi/agent/settings.json`. The Home Manager module adds the package path with an idempotent `jq` edit on activation and leaves the rest alone. A Nix-managed `settings.json` would break `/ext`.

## 1. One pi package, private extensions in a second repository (2026-10-25)

All extensions live in one package so that pi loads, toggles and reloads them. `ibm` and `anthropic-oauth` are in `zerodawn-pi-private` with the same layout, because they contain work infrastructure or should not be public. Nix installs both through the same kind of module.
