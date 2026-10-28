# Add copy: to profiles and move limits into the profile

A new worktree lacks files that git does not track. `copy:` copies them. Limits belong in the profile, not in code.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md

## Original text

One step at a time. Each step is its own PR.

6. Profile: `copy:` for files that git does not have (config.json, .env, links). Move the limits (gate tries, tokens) from code to the profile.
