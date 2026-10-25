{
  description = "Eigen pi-extensions (TypeScript)";

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
    in
    {
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
        }
      );

      devShells = forAll (
        { system, pkgs }:
        {
          default = pkgs.mkShell {
            # The global git config sets core.hooksPath to the central hooks, and pre-commit refuses
            # to install while any hooksPath is set; factory installs its hooks the same way.
            shellHook = ''
              GIT_CONFIG_GLOBAL=/dev/null bash -c ${
                pkgs.lib.escapeShellArg self.checks.${system}.pre-commit.shellHook
              }
            '';
            packages = [
              pkgs.nodejs_24
              pkgs.bun
              pkgs.typescript
              pkgs.biome
              pkgs.jq
              pkgs.gitleaks
              pkgs.pre-commit
            ];
          };
        }
      );
    };
}
