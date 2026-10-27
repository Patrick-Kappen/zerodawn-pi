{
  description = "zerodawn-pi: pi extensions (TypeScript)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # The source of pi: types and tests use the pi that the user runs. A consumer sets follows to its own llm-agents.
    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      git-hooks,
      llm-agents,
    }:
    let
      forAll =
        f:
        nixpkgs.lib.genAttrs [ "x86_64-linux" ] (
          system:
          f {
            inherit system;
            pkgs = nixpkgs.legacyPackages.${system};
          }
        );
      inherit (nixpkgs) lib;
      inherit (builtins.fromJSON (builtins.readFile ./package.json)) version;
      own = fileset: lib.fileset.difference fileset (lib.fileset.maybeMissing ./node_modules);
      # node_modules for tsc and the editor: pi and its dependencies (pi-ai, pi-tui, typebox, @types/node) from
      # the pi package of llm-agents, at the version the user runs. No lock file of its own, nothing to update by hand.
      # The packages are in $out/node_modules, not in $out: bun resolves a dependency of a package from its real
      # path, and finds typebox for pi-ai only in a parent directory named node_modules.
      pi = pkgs: llm-agents.packages.${pkgs.stdenv.hostPlatform.system}.pi;
      piModules =
        pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "pi-node-modules";
          inherit (pi pkgs) version src npmDeps;
          nativeBuildInputs = [
            pkgs.nodejs
            pkgs.npmHooks.npmConfigHook
          ];
          npmFlags = [ "--ignore-scripts" ];
          dontBuild = true;
          dontFixup = true;
          installPhase = ''
            mkdir -p $out/node_modules/@earendil-works/pi-coding-agent
            cp -r node_modules/. $out/node_modules/
            cp -r package.json dist $out/node_modules/@earendil-works/pi-coding-agent/
          '';
        };
      allSources = lib.fileset.toSource {
        root = ./.;
        fileset = own (
          lib.fileset.unions [
            ./package.json
            ./tsconfig.json
            (lib.fileset.fileFilter (file: file.hasExt "ts") ./.)
          ]
        );
      };
      # The shared helpers alone: their own tests, plus the manifest.
      sharedSources = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./package.json
          (lib.fileset.fileFilter (file: file.hasExt "ts") ./shared)
          (lib.fileset.maybeMissing ./shared/fixtures)
        ];
      };
      # Every extension has a package.json with a version and at least one test; a missing one fails the evaluation.
      checkExtension =
        name:
        let
          dir = ./extensions + "/${name}";
          manifest = dir + "/package.json";
          tests = lib.fileset.toList (lib.fileset.fileFilter (file: lib.hasSuffix ".test.ts" file.name) dir);
        in
        if !builtins.pathExists manifest then
          throw "extensions/${name}/package.json is missing; add it with name, version and description"
        else if !((builtins.fromJSON (builtins.readFile manifest)) ? version) then
          throw "extensions/${name}/package.json has no version"
        else if (builtins.fromJSON (builtins.readFile manifest)).version == "0.0.0" then
          throw "extensions/${name}/package.json has version 0.0.0; a new extension starts at 0.1.0"
        else if tests == [ ] then
          throw "extensions/${name} has no *.test.ts; add a test"
        else
          name;
      extensions = map checkExtension (
        builtins.attrNames (lib.filterAttrs (_: type: type == "directory") (builtins.readDir ./extensions))
      );
      # One test derivation per extension, with only that extension, shared/ and the manifest as input,
      # so an extension without changes is a cache hit.
      testSources =
        name:
        lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [
            ./package.json
            (lib.fileset.fileFilter (file: file.hasExt "ts") ./shared)
            (lib.fileset.maybeMissing ./shared/fixtures)
            (lib.fileset.fileFilter (
              file: file.hasExt "ts" || file.hasExt "txt" || file.name == "package.json"
            ) (./extensions + "/${name}"))
          ];
        };
      # The job tests spawn bash and script in a PTY; the sandbox has /dev/pts. The subagents tests start their own tmux server.
      # The run_tests tests make a git repository.
      testInputs = pkgs: [
        pkgs.bun
        pkgs.tmux
        pkgs.bashInteractive
        pkgs.util-linux
        pkgs.coreutils
        pkgs.gnused
        pkgs.gnugrep
        pkgs.git
        # The grep tool of files; pi brings rg on PATH at run time.
        pkgs.ripgrep
        # The syntax check of edit and write; its tests use the lua parser that nvim brings.
        pkgs.neovim-unwrapped
      ];
      runTests =
        pkgs: name: src:
        pkgs.runCommand "tests-${name}"
          {
            inherit src;
            nativeBuildInputs = testInputs pkgs;
          }
          ''
            cp -r "$src" src
            chmod -R u+w src
            ln -s ${piModules pkgs}/node_modules src/node_modules
            cd src
            HOME="$TMPDIR" bun test
            touch "$out"
          '';
      # The pi package: manifest and sources, without tests. Pi loads it from settings.json "packages".
      package =
        pkgs:
        pkgs.stdenvNoCC.mkDerivation {
          pname = "zerodawn-pi";
          inherit version;
          src = lib.fileset.toSource {
            root = ./.;
            fileset = own (
              lib.fileset.unions [
                ./package.json
                (lib.fileset.fileFilter (
                  file: (file.hasExt "ts" && !lib.hasSuffix ".test.ts" file.name) || file.name == "package.json"
                ) ./extensions)
                (lib.fileset.fileFilter (file: file.hasExt "ts" && !lib.hasSuffix ".test.ts" file.name) ./shared)
              ]
            );
          };
          dontBuild = true;
          installPhase = "cp -r . $out";
        };
    in
    {
      # treefmt, so nix fmt -- --fail-on-change FILES checks the staged files in the git pre-commit hook.
      formatter = forAll ({ pkgs, ... }: pkgs.nixfmt-tree);

      packages = forAll (
        { pkgs, ... }: rec {
          zerodawn-pi = package pkgs;
          default = zerodawn-pi;
        }
      );

      homeModules.default =
        {
          config,
          lib,
          pkgs,
          ...
        }:
        let
          cfg = config.programs.zerodawn-pi;
          settings = lib.filterAttrs (_: v: v != null) {
            astGrep = lib.getExe cfg.astGrep;
            nvim = lib.getExe cfg.nvim;
            treesitterParsers = "${pkgs.symlinkJoin {
              name = "pi-treesitter-parsers";
              paths = cfg.treesitterGrammars;
            }}";
            inherit (cfg) nixosRepo;
            subagentExtensions = if cfg.subagentExtensions == [ ] then null else cfg.subagentExtensions;
            subagentModels = if cfg.subagentModels == [ ] then null else cfg.subagentModels;
            handoffModels = if cfg.handoffModels == [ ] then null else cfg.handoffModels;
          };
          # The extensions read config.json next to package.json, so it is copied into the package.
          configured = pkgs.runCommand "${cfg.package.name}-configured" { } ''
            cp -r ${cfg.package} $out
            chmod u+w $out
            cp ${pkgs.writers.writeJSON "config.json" settings} $out/config.json
          '';
          cleanup = pkgs.writeShellApplication {
            name = "pi-tool-log-cleanup";
            runtimeInputs = [
              pkgs.coreutils
              pkgs.findutils
            ];
            text = ''
              dir="$HOME/.pi/agent/sessions"
              if [ ! -d "$dir" ]; then
                echo "pi-tool-log-cleanup: $dir does not exist, nothing to clean" >&2
                exit 0
              fi
              find "$dir" -mindepth 2 -maxdepth 2 -type d -regextype posix-extended \
                -regex '.*/[0-9]{4}-[0-9]{2}-[0-9]{2}T[^/]*_[0-9a-f-]{36}' -print0 |
                while IFS= read -r -d "" d; do
                  if [ ! -e "$d.jsonl" ] || [ -n "$(find "$d.jsonl" -mtime +${toString cfg.logCleanup.days})" ]; then
                    rm -rf -- "$d"
                  fi
                done
            '';
          };
        in
        {
          options.programs.zerodawn-pi = {
            enable = lib.mkEnableOption "the zerodawn-pi package for pi";
            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
              description = "The pi package to install. config.json is added to it.";
            };
            path = lib.mkOption {
              type = lib.types.str;
              default = ".pi/agent/packages/zerodawn-pi";
              description = "Install path, relative to the home directory. The activation script adds it to settings.json \"packages\".";
            };
            astGrep = lib.mkOption {
              type = lib.types.package;
              default = pkgs.ast-grep;
              description = "The ast-grep package for the ast_grep tool.";
            };
            nvim = lib.mkOption {
              type = lib.types.package;
              default = pkgs.neovim-unwrapped;
              description = "The Neovim package for the syntax check of edit and write.";
            };
            treesitterGrammars = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = with pkgs.vimPlugins.nvim-treesitter-parsers; [
                bash
                javascript
                json
                nix
                python
                tsx
                typescript
                yaml
              ];
              description = "Tree-sitter grammars (each with parser/<lang>.so) for the syntax check. A file type without its grammar fails the check.";
            };
            nixosRepo = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Checkout of the NixOS flake that built this system. systemstate reports the deployed revision against it.";
            };
            subagentExtensions = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [ ];
              description = "Absolute paths of extensions that every subagent loads, for example a provider login extension.";
            };
            handoffModels = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [
                "openai-codex/gpt-6-luna:low"
                "local/qwen3.6-35b-a3b"
                "ibm-next/qwen38-flash-next"
                "opencode/deepseek-v4.1-flash-free"
              ];
              description = "Models that write the handoff card, as provider/id[:thinking], in order. The first one with auth and a valid card is used.";
            };
            subagentModels = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [
                "opencode-go/deepseek-v4.1-flash:low"
                "anthropic/claude-sonnet-5-5:low"
              ];
              description = "Models for every subagent as provider/id[:thinking], in order. A subagent gets the first one that is available.";
            };
            logCleanup = {
              enable = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = "Remove the tool output of pi sessions that are gone or unchanged for `days` days, daily.";
              };
              days = lib.mkOption {
                type = lib.types.ints.positive;
                default = 30;
                description = "Age in days after which the tool output of an unchanged session is removed.";
              };
            };
          };

          config = lib.mkIf cfg.enable {
            home.file.${cfg.path}.source = configured;

            # settings.json is also written by pi and by /ext, so it is merged, not replaced.
            home.activation.zerodawn-pi = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
              f="$HOME/.pi/agent/settings.json"
              mkdir -p "$(dirname "$f")"
              [ -s "$f" ] || echo '{}' > "$f"
              ${lib.getExe pkgs.jq} --arg p "~/${cfg.path}" \
                '.packages = ((.packages // []) | if index($p) then . else . + [$p] end)' \
                "$f" > "$f.tmp" && mv "$f.tmp" "$f"
            '';

            systemd.user.services.pi-tool-log-cleanup = lib.mkIf cfg.logCleanup.enable {
              Unit.Description = "Remove the tool output of old pi sessions";
              Service = {
                Type = "oneshot";
                ExecStart = lib.getExe cleanup;
              };
            };

            systemd.user.timers.pi-tool-log-cleanup = lib.mkIf cfg.logCleanup.enable {
              Unit.Description = "Remove the tool output of old pi sessions, daily";
              Timer = {
                OnCalendar = "daily";
                Persistent = true;
              };
              Install.WantedBy = [ "timers.target" ];
            };
          };
        };

      checks = forAll (
        { system, pkgs }:
        {
          pre-commit = git-hooks.lib.${system}.run {
            src = self;
            hooks = {
              detect-private-keys.enable = true;
              check-added-large-files.enable = true;
              check-merge-conflicts.enable = true;
              # Fixtures are raw tool output: their whitespace is part of the test.
              end-of-file-fixer = {
                enable = true;
                excludes = [ "^shared/fixtures/" ];
              };
              # Fixtures are raw tool output: their whitespace is part of the test.
              trim-trailing-whitespace = {
                enable = true;
                excludes = [ "^shared/fixtures/" ];
              };
              no-commit-to-branch.enable = true;
              nixfmt.enable = true;
              statix.enable = true;
              deadnix.enable = true;
              biome.enable = true;
              shellcheck = {
                enable = true;
                files = "^scripts/.*\\.sh$";
              };
              commit-msg = {
                enable = true;
                name = "commit message: <extension|shared|area>: subject";
                entry = "${pkgs.bash}/bin/bash scripts/check-commit-msg.sh";
                stages = [ "commit-msg" ];
                pass_filenames = true;
              };
              branch-msgs = {
                enable = true;
                name = "every commit on the branch has <scope>: subject";
                entry = "${pkgs.bash}/bin/bash scripts/check-branch-msgs.sh";
                stages = [ "pre-push" ];
                pass_filenames = false;
                always_run = true;
              };
              sync-branch = {
                enable = true;
                name = "repository behaviour matches a sibling branch";
                entry = "${pkgs.writeShellScript "sync-branch" ''
                  export PATH=${
                    pkgs.lib.makeBinPath [
                      pkgs.git
                      pkgs.jq
                      pkgs.diffutils
                      pkgs.gawk
                      pkgs.gnused
                      pkgs.gnugrep
                      pkgs.coreutils
                    ]
                  }:$PATH
                  exec scripts/sync-branch.sh
                ''}";
                stages = [ "pre-push" ];
                pass_filenames = false;
                always_run = true;
              };
              # The full unit test suite before each commit; CI runs it again with the other checks.
              tests = {
                enable = true;
                name = "tests: the full unit test suite";
                entry = "${pkgs.writeShellScript "tests" ''
                  export PATH=${pkgs.lib.makeBinPath (testInputs pkgs)}:$PATH
                  [ -e node_modules ] || ln -s ${piModules pkgs}/node_modules node_modules
                  # git gives a hook GIT_INDEX_FILE and more; a test that makes its own repository then changes this index.
                  unset $(${pkgs.git}/bin/git rev-parse --local-env-vars)
                  # The nix check sandbox has no writable HOME.
                  [ -w "$HOME" ] || export HOME="$TMPDIR"
                  exec bun test
                ''}";
                pass_filenames = false;
                always_run = true;
              };
              gitleaks = {
                enable = true;
                name = "gitleaks";
                entry = "${pkgs.gitleaks}/bin/gitleaks git --pre-commit --staged --redact --no-banner";
                pass_filenames = false;
              };
            };
          };

          hooks-config = pkgs.runCommand "hooks-config" { } ''
            if ! diff -u ${self}/.pre-commit-config.yaml ${
              self.checks.${system}.pre-commit.config.configFile
            }; then
              echo "hooks-config: .pre-commit-config.yaml differs from the pre-commit config of flake.nix; run just hooks-config and commit it" >&2
              exit 1
            fi
            touch "$out"
          '';

          types =
            pkgs.runCommand "types"
              {
                src = allSources;
                nativeBuildInputs = [ pkgs.typescript ];
              }
              ''
                cp -r "$src" src
                chmod -R u+w src
                ln -s ${piModules pkgs}/node_modules src/node_modules
                cd src
                tsc
                touch "$out"
              '';

          tests-shared = runTests pkgs "shared" sharedSources;
        }
        // lib.listToAttrs (
          map (name: {
            name = "tests-${name}";
            value = runTests pkgs name (testSources name);
          }) extensions
        )
      );

      devShells = forAll (
        { system, pkgs }:
        {
          default = pkgs.mkShell {
            # The tracked .pre-commit-config.yaml names store paths; this reference builds them with the shell.
            ZD_HOOKS_CONFIG = self.checks.${system}.pre-commit.config.configFile;
            NODE_MODULES = "${piModules pkgs}/node_modules";
            PI_VERSION = (pi pkgs).version;
            # The hook links node_modules in the current directory: only in this repository.
            shellHook = "if [ -f scripts/shell-hook.sh ] && [ -f flake.nix ]; then source scripts/shell-hook.sh; fi";
            packages = [
              pkgs.nodejs_24
              pkgs.bun
              pkgs.typescript
              pkgs.typescript-language-server
              pkgs.biome
              pkgs.just
              pkgs.jq
              pkgs.gitleaks
              pkgs.pre-commit
              pkgs.nixfmt
              pkgs.statix
              pkgs.deadnix
              pkgs.shellcheck
              pkgs.util-linux
              # just compat runs released tests outside the nix checks; the files tests need nvim with its lua parser, and rg.
              pkgs.neovim-unwrapped
              pkgs.ripgrep
            ];
          };
        }
      );
    };
}
