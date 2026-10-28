# Protect merges with required CI on the current base

A failed or old check must block a merge.

## Source

- zerodawn-pi main: docs/ci-release-plan.md (stage 5)

## Original text

## 5. Protect merges

- Require CI before merge.
- Require checks against the current base.
- Keep the current merge method.
- Delete merged branches automatically.
- Check shared tooling consistency in CI.
- Apply shared tooling changes through paired PRs in both pi repositories.

Done when: failed or outdated checks block merging.
