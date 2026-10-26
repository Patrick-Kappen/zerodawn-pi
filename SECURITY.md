# Security

## What these extensions do on your machine

pi extensions run in pi's process with your user's rights. These extensions:

- run shell commands the model asks for (`bash`, through `script` in a PTY) and keep their output under the session directory (`~/.pi/agent/sessions/<session>/out` and `jobs`), which the Nix module removes after 30 days;
- read and write files the model asks for (`files`), with a guard against overwriting large files;
- run `git` read-only (`git`), `ast-grep` (`ast-grep`), `just` and `make` for recipe listings (`tests`), and `opencode` (`opencode`) when installed;
- read `/run/current-system` and `nixos-version` (`systemstate`), and `/proc` for child processes of pi (`watchdog`);
- write `~/.pi/agent/settings.json` and `<project>/.pi/settings.json` when you use `/ext` (`core`);
- send the pi session id as a request header to the model gateway (`gateway`); nothing else leaves the machine beyond what pi already sends to the model provider.

No extension needs a secret. `config.json` holds paths, not credentials.

The agent decides which commands to run; the guards here (blocked git commands, repeated test runs, write size, wait-only commands) are hints for the model, not a sandbox. Run pi in a sandbox or container when you do not trust the task.

## Supply chain

- Runtime: the extensions import only pi's own packages (`@earendil-works/pi-*`) and `typebox`, which pi ships. There is no install step and no other runtime dependency.
- Development: there are no npm dev dependencies of our own. The types and tests use pi and its packages from the `llm-agents` flake input, pinned by `flake.lock`.
- CI uses the Determinate Nix installer and the GitHub token with `contents: read`; the release job has `contents: write` only to push tags and create releases.
- gitleaks runs on every commit.

## Report a problem

Open a private security advisory on GitHub (Security → Report a vulnerability), or mail the address in the commit history. Say which extension, what you ran, and what happened. Expect an answer within a week; a fix comes as a patch release with a changelog entry.
