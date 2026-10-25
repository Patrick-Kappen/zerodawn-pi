# systemstate

Adds `system_state` (active NixOS system) and `nixos_deployment` (deployed revision vs HEAD of the flake checkout) to the system prompt and refreshes them during the session. Needs `nixosRepo` in `config.json` for the deployment section; without it only `system_state` is reported. Text building is pure and tested.
