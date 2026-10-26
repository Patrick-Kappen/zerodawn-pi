# zerodawn-pi

Extensions for [pi](https://pi.dev), the terminal coding agent, packaged as one pi package and one Nix flake. They make the agent's loop cheaper and more predictable: a `bash` tool that runs every command in a PTY and reports long jobs, a compact read-only `git` tool, context pruning, a guard against repeated test runs, a cleaner transcript, and a watchdog for runs that hang. Each extension is independent: switch any of them on or off with `/ext`.

| Extension | What it does |
|---|---|
| [bash](extensions/bash/README.md) | `bash` runs in a PTY under `script`, so colors and progress lines survive. Long output comes back as head, error lines, tail and a log path. `background: true` returns a job id; a dashboard above the editor shows every running tool, and `jobs` waits, lists or kills. Jobs survive a pi restart. |
| [files](extensions/files/README.md) | `read`, `grep`, `edit`, `write` with shorter descriptions. `edit` retries a mismatch with the file's indentation and shows the lines around each change. `write` refuses to overwrite a file of more than 100 lines. |
| [git](extensions/git/README.md) | `git` tool for status, diff, log and show with compact output (per-file summaries, merged directories). The same commands in bash are blocked with a hint; `# raw-git` bypasses. |
| [tests](extensions/tests/README.md) | Puts the recipes of the project's `justfile` or `Makefile` in the system prompt, blocks a repeated test run without an edit in between, and hints to turn a long repeated command into a recipe. |
| [ctx-manager](extensions/ctx-manager/README.md) | At the end of a turn, replaces old large tool results in the model context by one line with the tool, size, first line and log path. The transcript on screen stays. |
| [core](extensions/core/README.md) | `/ext`: a list with toggles for extensions, skills, prompts and themes, per user or per project, written in the format of `pi config`. |
| [ui](extensions/ui/README.md) | `/view` (normal, compact, text, silent), `/messages` (row, rule), a one-line footer, code blocks without fences, a working indicator without tool names. |
| [ast-grep](extensions/ast-grep/README.md) | `ast_grep` tool: structural search by code pattern with `$NAME` and `$$$`; `rewrite` previews, never writes. |
| [opencode](extensions/opencode/README.md) | `opencode` tool: hands one task to an OpenCode agent in the same project and returns its report. |
| [subagents](extensions/subagents/README.md) | Work in progress. Delegates tasks to pi agents in a detached tmux session per main agent; a supervisor in window 0 owns them. |
| [systemstate](extensions/systemstate/README.md) | Puts the active NixOS system and, inside your flake checkout, the deployed revision against `HEAD` in the system prompt; updates them during the session. |
| [watchdog](extensions/watchdog/README.md) | Detects a run that hangs, asks a classifier model to confirm, aborts, goes back to the last good point and continues. `/unstick` does it by hand. |
| [gateway](extensions/gateway/README.md) | Sends the pi session id to agentgateway so its logs group requests by session. |

Every extension has its own README with tools, keys, commands and constants, an `AGENTS.md` for coding agents, a `CHANGELOG.md` and tests. [shared/](shared/README.md) holds the few helpers they share.

## Install with Nix

This repository is a flake. It exports:

| Output | What |
|---|---|
| `packages.<system>.default` | the pi package: `package.json`, `extensions/`, `shared/`, without tests |
| `homeModules.default` | a Home Manager module, `programs.zerodawn-pi` |
| `checks.<system>.*` | `types` (tsc), `tests-<extension>`, `tests-shared`, `pre-commit` |
| `devShells.<system>.default` | bun, tsc, the TypeScript LSP, biome, just, shellcheck, the nix linters |
| `formatter.<system>` | nixfmt over the tree |

```nix
inputs.zerodawn-pi.url = "github:Patrick-Kappen/zerodawn-pi";

# in the Home Manager configuration
imports = [ inputs.zerodawn-pi.homeModules.default ];
programs.zerodawn-pi = {
  enable = true;
  nixosRepo = "/home/me/nixos-config"; # optional, for systemstate
};
```

The module:
- installs the package with a generated `config.json` at `~/.pi/agent/packages/zerodawn-pi` (option `path`); `astGrep` defaults to `pkgs.ast-grep`;
- adds that path to `~/.pi/agent/settings.json` `packages` on activation with an idempotent `jq` edit, and leaves the rest of the file alone, so `/ext` keeps working;
- adds a daily timer that removes the tool output of sessions that are gone or unchanged for 30 days (`logCleanup.enable`, `logCleanup.days`).

Pin a tag (`github:Patrick-Kappen/zerodawn-pi/v0.2.0`) or follow `main` and update with `nix flake update zerodawn-pi`; `flake.lock` pins the commit either way. Releases are tagged `v<version>`; each extension also gets `<name>-v<version>` when it changes.

The types and tests use pi from the `llm-agents` flake input. Set `inputs.zerodawn-pi.inputs.llm-agents.follows = "llm-agents"` to use the same pi as your system; `just pi-version` fails when the lock and the installed pi differ.

## Install without Nix

Clone the repository and add it to `~/.pi/agent/settings.json`:

```json
{ "packages": ["/path/to/zerodawn-pi"] }
```

Some extensions read `config.json` next to `package.json`; copy `config.example.json`. All keys are optional: `astGrep` (path of the binary; default from `PATH`), `nixosRepo` (checkout of your NixOS flake). A key with a wrong type fails at load with the file path.

## Docs

- [docs/decisions.md](docs/decisions.md): the choices that shape this repository, with reasons.
- [docs/todo.md](docs/todo.md): open points.
- [shared/README.md](shared/README.md): the shared helpers and their compatibility rule.
- [CONTRIBUTING.md](CONTRIBUTING.md): branch, commit, test and release workflow.
- [SECURITY.md](SECURITY.md): what the extensions can do on your machine, and how to report a problem.
- `CHANGELOG.md` here, in `shared/` and in every extension; the last releases are at the end of this file and of each extension README.

## Develop

`direnv allow` loads the dev shell from `flake.nix`. The shell installs the git hooks and the pinned pi types, so `tsc` and the LSP see the same API as the installed pi.

| Command | What |
|---|---|
| `just test` | unit tests (`bun test`) |
| `just types` | type check (`tsc`) |
| `just lint` | biome and shellcheck |
| `just fmt` | format and apply safe fixes |
| `just check` | lint, types, tests, `nix flake check` |
| `just dev` | pi in a tmux sandbox with all extensions; `just dev-screen`, `just dev-send "…"`, `just dev-key C-c`, `just dev-stop` |

Release and maintenance commands are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Changes

<!-- changelog:start -->
## 0.3.1 — 2026-10-26

### bash 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

### core 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

### gateway 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

### opencode 0.1.1

- deps: take pi and its packages from llm-agents, not from npm

## 0.3.0 — 2026-10-25

### shared 0.1.0

- First release.

### ast-grep 0.1.0

- First release.

### bash 0.1.0

- First release.

### core 0.1.0

- First release.

### ctx-manager 0.1.0

- First release.

### files 0.1.0

- First release.

### gateway 0.1.0

- First release.

### git 0.1.0

- First release.

### opencode 0.1.0

- First release.

### systemstate 0.1.0

- First release.

### tests 0.1.0

- First release.

### ui 0.1.0

- First release.

### watchdog 0.1.0

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
