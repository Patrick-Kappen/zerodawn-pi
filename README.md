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
| [debug](extensions/debug/README.md) | `debug` tool: debugs a program or test through the user's Neovim server and nvim-dap (breakpoints, stepping, eval). Exists only when `PI_DEBUG_SERVER` is set; the Home Manager option `debugServer` sets it. |
| [opencode](extensions/opencode/README.md) | `opencode` tool: hands one task to an OpenCode agent in the same project and returns its report. |
| [subagents](extensions/subagents/README.md) | Work in progress. Delegates tasks to pi agents in a detached tmux session per main agent; a supervisor in window 0 owns them. |
| [systemstate](extensions/systemstate/README.md) | Puts the active NixOS system and, inside your flake checkout, the deployed revision against `HEAD` in the system prompt; updates them during the session. |
| [watchdog](extensions/watchdog/README.md) | Detects a run that hangs, asks a classifier model to confirm, aborts, goes back to the last good point and continues. `/unstick` does it by hand. |
| [checker](extensions/checker/README.md) | Before the agent finishes, asks a classifier whether the work is done. It sends the agent back with a hidden message when it left an error in scope, asked a question it can answer itself, or stopped halfway. At most 3 times per message. |
| [gateway](extensions/gateway/README.md) | Sends the pi session id to agentgateway so its logs group requests by session. |
| [handoff](extensions/handoff/README.md) | `/handoff`: a cheap model writes a handoff card from a stripped transcript; the code adds git, PR and job facts; a new session starts with it. |
| [lsp](extensions/lsp/README.md) | After each `edit` or `write`, reports the LSP errors of the file from the user's Neovim server (`PI_LSP_SERVER`); only errors, and never a clean result when the query failed. |

Every extension has its own README with tools, keys, commands and constants, an `AGENTS.md` for coding agents, a `CHANGELOG.md` and tests. [shared/](shared/README.md) holds the few helpers they share.

## Install with Nix

This repository is a flake. It exports:

| Output | What |
|---|---|
| `packages.<system>.default` | the pi package: `package.json`, `extensions/`, `shared/`, without tests |
| `homeModules.default` | a Home Manager module, `programs.zerodawn-pi` |
| `checks.<system>.*` | `types` (tsc), `tests-<extension>`, `tests-shared`, `pre-commit`, `hooks-config` |
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
- installs the package with a generated `config.json` at `~/.pi/agent/packages/zerodawn-pi` (option `path`); `astGrep` defaults to `pkgs.ast-grep`, `nvim` to `pkgs.neovim-unwrapped`, `treesitterGrammars` to the grammars for bash, javascript, json, nix, python, tsx, typescript and yaml;
- adds that path to `~/.pi/agent/settings.json` `packages` on activation with an idempotent `jq` edit, and leaves the rest of the file alone, so `/ext` keeps working;
- adds a daily timer that removes the tool output of sessions that are gone or unchanged for 30 days (`logCleanup.enable`, `logCleanup.days`);
- sets `PI_LSP_SERVER` from `lspServer` (default `null`, off) so the `lsp` extension uses the user's Neovim server.

Pin a tag (`github:Patrick-Kappen/zerodawn-pi/v0.2.0`) or follow `main` and update with `nix flake update zerodawn-pi`; `flake.lock` pins the commit either way. Releases are tagged `v<version>`; each extension also gets `<name>-v<version>` when it changes.

The types and tests use pi from the `llm-agents` flake input. Set `inputs.zerodawn-pi.inputs.llm-agents.follows = "llm-agents"` to use the same pi as your system; `just pi-version` fails when the lock and the installed pi differ.

## Install without Nix

Clone the repository and add it to `~/.pi/agent/settings.json`:

```json
{ "packages": ["/path/to/zerodawn-pi"] }
```

Some extensions read `config.json` next to `package.json`; copy `config.example.json`. All keys are optional: `astGrep` (path of the binary; default from `PATH`), `nvim` (path of the binary for the syntax check of edit and write; default from `PATH`), `treesitterParsers` (directory with a `parser/` directory of tree-sitter grammars for that check), `nixosRepo` (checkout of your NixOS flake), `subagentExtensions` (absolute paths of extensions that every subagent loads, for example a provider login), `subagentModels` (the model ladder of the subagents, `provider/id[:thinking]`, in order; the subagent tool needs it, Home Manager sets a default), `handoffModels` (the models that write the handoff card, same format; `/handoff` needs it, Home Manager sets a default). `ZERODAWN_PI_CONFIG` points to another `config.json`; `just dev` uses it for the config of the installed package. A key with a wrong type fails at load with the file path.

## Docs

- [docs/decisions.md](docs/decisions.md): the choices that shape this repository, with reasons.
- [docs/ci-baseline.md](docs/ci-baseline.md): measured test coverage, behavior contracts, and CI gaps.
- [docs/todo/TODO.md](docs/todo/TODO.md) and [docs/todo/BACKLOG.md](docs/todo/BACKLOG.md): open work, one file per task in [docs/tasks/](docs/tasks/).
- [shared/README.md](shared/README.md): the shared helpers and their compatibility rule.
- [CONTRIBUTING.md](CONTRIBUTING.md): branch, commit, test and release workflow.
- [SECURITY.md](SECURITY.md): what the extensions can do on your machine, and how to report a problem.
- `CHANGELOG.md` here, in `shared/` and in every extension; the last releases are at the end of this file and of each extension README.

## Develop

`direnv allow` loads the dev shell from `flake.nix`. The shell links the pinned pi types, so `tsc` and the LSP see the same API as the installed pi.

| Command | What |
|---|---|
| `just test` | both test groups |
| `just test-unit` | isolated logic, with mocks and static fixtures |
| `just test-integration` | real files, processes, sockets, Git, tmux, and extension contracts |
| `just types` | type check (`tsc`) |
| `just lint` | biome and shellcheck |
| `just fmt` | format and apply safe fixes |
| `just check` | lint, types, tests, `nix flake check` |
| `just dev` | pi in a tmux sandbox with all extensions; `just dev-screen`, `just dev-send "…"`, `just dev-key C-c`, `just dev-stop`. `PI_DEV=<name>` on each of them gives a separate session and sandbox |

Integration tests use `*.integration.test.ts` beside their source, or `*.test.ts` under `integration/`.
Other `*.test.ts` files contain unit tests. Static fixture reads are allowed; real file changes and external processes belong in integration tests.
Mixed files stay in the integration group unless their tests are split. No test calls paid providers.

`run_tests` runs affected unit tests during source edits. Changes to integration tests also run the integration group.
Changes to shared code or the root manifest run all unit tests. Changes to repository tooling run all Nix checks.
`just test` and `just check` run both groups. Nix runs units per extension and shared module, and integrations as `tests-integration`.
Commit hooks automatically run unit tests and static checks. A unit failure blocks the commit.
CI runs integration tests, type checks, Nix checks, and compatibility checks when required.
Agents do not need a manual test checklist. The commands above remain available to investigate failures.
See [docs/test-separation.md](docs/test-separation.md) for measurements and scope.

CI selects checks from changed files on PRs and pushes to main.
Documentation changes run formatting and safety checks, without tests.
Extension changes run that extension, integration tests, and type checks.
Shared code and build inputs run every suite. Each Nix test check runs only its own suite.
The Nix formatting check skips the local test hook; local commits keep that hook.
See [docs/ci-selection.md](docs/ci-selection.md) for selection rules and test review limits.

Release and maintenance commands are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Changes

<!-- changelog:start -->
## 0.23.0 — 2026-10-28

### lsp 0.1.1

- end a clean file on quiet LSP progress, not a timeout

### repository

- lsp: end a clean file on quiet LSP progress, not a timeout
- debug: add a debug tool that drives nvim-dap in the user's nvim
- lsp: report LSP errors after edit and write from the user's nvim

## 0.22.0 — 2026-10-28

### bash 0.11.0

- wait inline for a call alone in its message

### tests 0.9.0

- run the tests of a file after each edit, report only red (breaking)

### repository

- docs: put the test hook decision on top as 39
- ci: read the bun pass lines also with colour codes
- ci: keep the git variables of a hook away from the tests
- ci: test staged files at commit, every test at push
- bash: wait inline for a call alone in its message

## 0.21.0 — 2026-10-28

### bash 0.10.0

- run long commands and tests in the background at once (breaking)

### opencode 0.4.0

- show the error event before the exit code

- return at once; a message gives the report (breaking)

### subagents 0.10.0

- start and answer return the id; a message gives the result (breaking)

### tests 0.8.0

- bash: run long commands and tests in the background at once (breaking)

### repository

- bash: run long commands and tests in the background at once

[All changes](CHANGELOG.md)
<!-- changelog:end -->
