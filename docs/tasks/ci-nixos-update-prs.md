# Create tested NixOS update PRs for published releases

A published release reaches NixOS through a tested PR. Deployment stays manual. A GitHub App needs owner setup.

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
