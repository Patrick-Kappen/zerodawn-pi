{
  description = "zerodawn-pi: pi extensions (TypeScript)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      git-hooks,
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
      # Files that the tests need: sources, tests, PTY fixtures, manifest.
      own = fileset: lib.fileset.difference fileset (lib.fileset.maybeMissing ./node_modules);
      sources = lib.fileset.toSource {
        root = ./.;
        fileset = own (
          lib.fileset.unions [
            ./package.json
            (lib.fileset.fileFilter (file: file.hasExt "ts" || file.hasExt "txt") ./.)
          ]
        );
      };
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
                (lib.fileset.fileFilter (file: file.hasExt "ts" && !lib.hasSuffix ".test.ts" file.name) ./.)
              ]
            );
          };
          dontBuild = true;
          installPhase = "cp -r . $out";
        };
    in
    {
      formatter = forAll ({ pkgs, ... }: pkgs.nixfmt);

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
            inherit (cfg) nixosRepo;
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
            nixosRepo = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Checkout of the NixOS flake that built this system. system-state reports the deployed revision against it.";
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
              end-of-file-fixer.enable = true;
              trim-trailing-whitespace.enable = true;
              no-commit-to-branch.enable = true;
              nixfmt.enable = true;
              statix.enable = true;
              deadnix.enable = true;
              biome.enable = true;
              gitleaks = {
                enable = true;
                name = "gitleaks";
                entry = "${pkgs.gitleaks}/bin/gitleaks git --pre-commit --staged --redact --no-banner";
                pass_filenames = false;
              };
            };
          };

          # The job tests spawn bash and script in a PTY; the sandbox has /dev/pts.
          tests =
            pkgs.runCommand "zerodawn-pi-tests"
              {
                src = sources;
                nativeBuildInputs = [
                  pkgs.bun
                  pkgs.bashInteractive
                  pkgs.util-linux
                  pkgs.coreutils
                  pkgs.gnused
                  pkgs.gnugrep
                ];
              }
              ''
                cp -r "$src" src
                chmod -R u+w src
                cd src
                HOME="$TMPDIR" bun test
                touch "$out"
              '';
        }
      );

      devShells = forAll (
        { system, pkgs }:
        {
          default = pkgs.mkShell {
            # The global git config sets core.hooksPath to the central hooks, and pre-commit refuses
            # to install while any hooksPath is set; factory installs its hooks the same way.
            # bun install fetches the pinned pi types from package.json, so tsc and the LSP
            # see the same API as the installed pi.
            shellHook = ''
              GIT_CONFIG_GLOBAL=/dev/null bash -c ${
                pkgs.lib.escapeShellArg self.checks.${system}.pre-commit.shellHook
              }
              if [ ! -d node_modules ] || [ bun.lock -nt node_modules/.bun-tag ] || [ package.json -nt node_modules/.bun-tag ]; then
                bun install --frozen-lockfile && touch node_modules/.bun-tag
              fi
            '';
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
              pkgs.util-linux
            ];
          };
        }
      );
    };
}
