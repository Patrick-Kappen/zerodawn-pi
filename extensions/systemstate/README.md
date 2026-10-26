# systemstate

Adds two sections to the system prompt and keeps them current during the session:

- `system_state`: the active NixOS system (`/run/current-system`) and whether it changed since the session started.
- `nixos_deployment`: when the working directory is the NixOS flake checkout, the deployed revision (`nixos-version --json`) against `HEAD`: deployed, ahead, or dirty.

## Config

`nixosRepo` in `config.json`: the checkout of the NixOS flake. Without it, only `system_state` is reported. The Nix module sets it from `programs.zerodawn-pi.nixosRepo`.

## Changes

<!-- changelog:start -->
## 0.2.0 — 2026-10-26

- docs: AGENTS.md of each extension as rules, facts to README

[All changes](CHANGELOG.md)
<!-- changelog:end -->
