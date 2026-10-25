# zerodawn-pi

A [pi](https://pi.dev) package with independent extensions. Each extension has its own directory under `extensions/` and a README.

| Extension | What it does |
|---|---|
| [bash-jobs](extensions/bash-jobs/README.md) | `bash` tool in a PTY, job dashboard, background jobs with reports, `jobs` tool |
| [builtins](extensions/builtins/README.md) | `read`, `grep`, `edit`, `write` with shorter descriptions, an indent fix for `edit`, a write guard |
| [git-tool](extensions/git-tool/README.md) | compact read-only `git` tool; blocks `git status/diff/log/show` in bash |
| [recipes](extensions/recipes/README.md) | justfile and Makefile recipes in the system prompt; blocks a repeated test run |
| [prune](extensions/prune/README.md) | replaces old large tool results with one line |
| [ext-switch](extensions/ext-switch/README.md) | `/ext`: enable or disable extensions, skills, prompts and themes |
| [tidy-ui](extensions/tidy-ui/README.md) | transcript views, message style, footer, code blocks, working indicator |
| [ast-grep](extensions/ast-grep/README.md) | `ast_grep` tool: structural code search |
| [opencode-subagent](extensions/opencode-subagent/README.md) | `opencode` tool: one task for an OpenCode agent |
| [system-state](extensions/system-state/README.md) | active NixOS system and deployed revision in the system prompt |
| [stall-watchdog](extensions/stall-watchdog/README.md) | aborts a run that stalls and continues from the last good point; `/unstick` |
| [gateway-session](extensions/gateway-session/README.md) | sends the session id to agentgateway, so its logs group requests by session |

## Install

Add the package to `~/.pi/agent/settings.json`:

```json
{ "packages": ["/path/to/zerodawn-pi"] }
```

Or clone it into `~/.pi/agent/packages/`. Turn single extensions on or off with `/ext` or `pi config`.

### Config

Some extensions read `config.json` next to `package.json`; see `config.example.json`. All keys are optional: `astGrep` (path of the binary; default from `PATH`), `nixosRepo` (checkout of your NixOS flake). A key with a wrong type fails at load with the file path.

### With Nix and Home Manager

The flake exports the package (`packages.<system>.default`) and a Home Manager module. Pin a release tag:

```nix
inputs.zerodawn-pi.url = "github:Patrick-Kappen/zerodawn-pi/v0.1.0";

# in the Home Manager configuration
imports = [ inputs.zerodawn-pi.homeModules.default ];
programs.zerodawn-pi = {
  enable = true;
  nixosRepo = "/home/me/nixos-config"; # optional
};
```

The module:
- installs the package with a generated `config.json` at `~/.pi/agent/packages/zerodawn-pi` (option `path`); `astGrep` defaults to `pkgs.ast-grep`;
- adds the install path to `~/.pi/agent/settings.json` `packages` on activation, and leaves the rest of that file alone, so `/ext` keeps working;
- adds a daily timer that removes the tool output of sessions that are gone or unchanged for 30 days (`logCleanup.enable`, `logCleanup.days`).

Releases: `just bump <version>` sets the version in `package.json` and commits it. After the push to `main`, CI runs all checks, tags `v<version>` and creates the GitHub release. Each extension has its own `package.json` with a version; `just bump <version> <extension>` bumps one, and CI tags it as `<extension>-v<version>`. A push without a new version creates no tag. Every extension needs a `package.json` and at least one `*.test.ts`; `nix flake check` fails without them.

## Develop

`direnv allow` loads the dev shell from `flake.nix`: `bun`, `tsc`, `typescript-language-server`, `biome`, `just`, and the nix linters. The shell installs the pinned pi types from `package.json`, so `tsc` and the LSP see the same API as the installed pi.

| Command | What |
|---|---|
| `just test` | unit tests (`bun test`) |
| `just types` | type check (`tsc`) |
| `just lint` | format and lint check (`biome`) |
| `just fmt` | format and apply safe fixes |
| `just check` | lint, types, tests, `nix flake check` |
| `just dev` | pi in a tmux sandbox with all extensions; `just dev-screen`, `just dev-send "…"`, `just dev-key C-c`, `just dev-stop` |
| `just bump <version> [extension]` | set and commit a new version of the package or of one extension |

CI (`.github/workflows/ci.yml`) runs `nix flake check` and `just types` on every push and pull request.

Rules:
- An extension imports only from its own directory and `shared/`.
- Tests live next to the code as `*.test.ts`.
- Constants live in one `config.ts` per extension, or at the top of the file. No settings UI.
- Fail loud: no fallback that hides a missing input.
