# Add a cheap merge profile; the supervisor watches the PR

A cheap model only fixes. The supervisor watches the PR, so the agent does not spend tokens on waiting. `done` comes only after a good merge or release.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md

## Original text

One step at a time. Each step is its own PR.

3. Merge profile: a cheap model that only fixes. The supervisor, not the agent, watches the PR (webhook or polling): green or red, more work on red, ask or blocker. `done` only when the merge succeeded; for a release only when the release succeeded.
