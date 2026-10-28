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
| [checker](extensions/checker/README.md) | Before the agent finishes, asks a classifier whether the work is done. It sends the agent back with a hidden message when it left an error in scope, asked a question it can answer itself, or stopped halfway. At most 3 times per message. |
| [gateway](extensions/gateway/README.md) | Sends the pi session id to agentgateway so its logs group requests by session. |
| [handoff](extensions/handoff/README.md) | `/handoff`: a cheap model writes a handoff card from a stripped transcript; the code adds git, PR and job facts; a new session starts with it. |

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
- adds a daily timer that removes the tool output of sessions that are gone or unchanged for 30 days (`logCleanup.enable`, `logCleanup.days`).

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
| `just test` | all tests (`bun test`) |
| `just test-integration` | contracts between extensions and release scripts |
| `just types` | type check (`tsc`) |
| `just lint` | biome and shellcheck |
| `just fmt` | format and apply safe fixes |
| `just check` | lint, types, tests, `nix flake check` |
| `just dev` | pi in a tmux sandbox with all extensions; `just dev-screen`, `just dev-send "…"`, `just dev-key C-c`, `just dev-stop`. `PI_DEV=<name>` on each of them gives a separate session and sandbox |

The tests in `integration/` use real local processes and fixed model responses. They do not call paid providers.
Affected extension tests also run this group. Nix runs it as `tests-integration`.

Release and maintenance commands are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Changes

<!-- changelog:start -->
## 0.19.0 — 2026-10-28

### shared 0.10.0

- projects: /switch picker, /ide pair, pi-tui-kit dependency

### ast-grep 0.3.1

- docs: split open work in TODO.md and BACKLOG.md

### bash 0.8.1

- docs: split open work in TODO.md and BACKLOG.md

### checker 0.3.0

- handoff: short warning, tool handoff for an early cut

- check a final answer after a handoff warning

- send back a check that the agent left open

### ctx-manager 0.2.2

- docs: split open work in TODO.md and BACKLOG.md

### files 0.5.1

- docs: split open work in TODO.md and BACKLOG.md

### git 0.5.1

- docs: split open work in TODO.md and BACKLOG.md

### handoff 0.3.0

- short warning, tool handoff for an early cut

- keep the boundary entries of other extensions

- cut in the middle of the work, keep the final answer

### opencode 0.3.1

- docs: split open work in TODO.md and BACKLOG.md

### pair 0.1.0

- First release.

### projects 0.1.0

- First release.

### subagents 0.8.4

- docs: split open work in TODO.md and BACKLOG.md

### systemstate 0.2.1

- docs: split open work in TODO.md and BACKLOG.md

### tests 0.6.2

- docs: split open work in TODO.md and BACKLOG.md

- a check with a pipe reports the failure of any part

### ui 0.2.2

- docs: split open work in TODO.md and BACKLOG.md

### watchdog 0.2.1

- docs: split open work in TODO.md and BACKLOG.md

### repository

- projects: keep the dependencies of pi-tui-kit in its own node_modules
- projects: /switch picker, /ide pair, pi-tui-kit dependency
- docs: record the automatic checks and test quality plan
- docs: split open work in TODO.md and BACKLOG.md
- docs: name the checklist TODO.md
- docs: collect all open points in one checklist with a file per task
- handoff: short warning, tool handoff for an early cut
- handoff: keep the boundary entries of other extensions
- handoff: cut in the middle of the work, keep the final answer
- docs: record accepted NixOS warnings for continued pi work
- ci: record baseline and run behavior contracts
- tests: cover release preparation behavior
- tests: cover checker and background job behavior

## 0.18.0 — 2026-10-27

### checker 0.2.1

- accept a rebuttal, fixed limit per user message

- a step for the user is not an open point

- handoff: cut at the end of a run after the warning

### handoff 0.2.0

- cut at the end of a run after the warning

- resume after a cut, check PR status of the card

### repository

- docs: record the CI and release plan
- checker: accept a rebuttal, fixed limit per user message
- flake: clear the default gitleaks args
- repo: git hooks from tracked .githooks, not from the dev shell
- handoff: cut at the end of a run after the warning
- flake: clear the default gitleaks args
- flake
- handoff: gpt-6-luna first in the default card ladder
- handoff: resume after a cut, check PR status of the card

## 0.17.0 — 2026-10-27

### shared 0.9.0

- a red check shows biome errors without a position

- handoffModels in config.json and the Home Manager module

### checker 0.2.0

- send back an offered step, no notice per follow-up

- also check runs that end on assistant text

- count follow-ups in a row; a tool call resets the count

- shorter follow-up text, no reason for skipped tests

- shorter follow-up text, no reason for skipped tests

### handoff 0.1.0

- First release.

### subagents 0.8.3

- no provider tool choice for the end tools

- the model probe sends a session id for opencode-go

- no start error in a repository without a commit

### tests 0.6.1

- a check with cd runs in the environment of that directory

### ui 0.2.1

- no crash when the terminal is 0 or 1 column wide

### repository

- handoff: short card with state, next actions and PR status
- subagents: no provider tool choice for the end tools
- checker: count follow-ups in a row; a tool call resets the count
- checker: shorter follow-up text, no reason for skipped tests
- checker: shorter follow-up text, no reason for skipped tests
- flake: run the full test suite in a pre-commit hook
- flake: run the full test suite in a pre-commit hook
- handoff: card from a stripped transcript, /handoff to a new session
- shared: handoffModels in config.json and the Home Manager module
- docs: backlog item to restart pi sessions after a rebuild
- docs: open points from the v0.15.0 release session

[All changes](CHANGELOG.md)
<!-- changelog:end -->
