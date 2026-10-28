# Create tested NixOS update PRs for published releases

A published release reaches NixOS through a tested PR. The owner merges the PR, and the merge deploys.

## Decisions

- The pi release job starts the update, not a schedule. It sends a `pi-release` event with the repository name and the package tag to Nixos.
- Nixos keeps one PR for each input on `release/<input>`. The next release updates the same PR.
- nixbot on meridian builds the PR and fills `nix-cache`. The merge to main runs the deploy steps. This replaces "Keep deployment approval manual": the merge is the approval.
- nixbot builds PRs without approval only for the owner and collaborators. Draft PRs also build.
- One fine-grained token `NIXOS_UPDATE_TOKEN` sends the event and creates the PR. A PR from the token owner gets the normal Nixos checks.

## Status

Open PRs, all checks green:

- Nixos #413: nixbot builds both pi repositories, trusts only owner and collaborators, and adds the workflow `pi-release`.
- zerodawn-pi #132 and zerodawn-pi-private #37: the release job sends the `pi-release` event (`scripts/ci-nixos-update.sh`).

Only a local copy tested the update step in Nixos. No real release ran it yet.

## Next

1. Make a fine-grained token: contents and pull requests write on Nixos, contents read on zerodawn-pi-private.
2. Add it as secret `NIXOS_UPDATE_TOKEN` in Nixos, zerodawn-pi and zerodawn-pi-private.
3. Install the nixbot GitHub App on zerodawn-pi and zerodawn-pi-private.
4. Add other owner accounts as collaborators.
5. Merge Nixos #413, then zerodawn-pi #132 and zerodawn-pi-private #37.
6. Do a test by hand: `gh workflow run pi-release.yml -R Patrick-Kappen/Nixos -f input=zerodawn-pi -f tag=<latest tag>`. Make sure it reports "main already uses". Then make sure the next real release creates or updates the PR, nixbot builds it, and the merge deploys.
7. Then close this task.

## Source

- zerodawn-pi main: docs/ci-release-plan.md (stage 7)

## Original text

## 7. Create NixOS update PRs

Add a scheduled and manually runnable workflow in `Patrick-Kappen/Nixos`.

- Select published pi releases, not unreleased changes.
- Update the relevant inputs and lock entries.
- Create or update one PR.
- Run Nix checks and build affected configurations.
- Test against the pi version selected by the consumer inputs.
- Keep merge and deployment approval manual.

Use a narrowly scoped GitHub App so bot-created PRs receive normal CI checks. App installation and credentials need owner setup.

Done when: a published release reaches NixOS through a tested PR, without automatic deployment.
