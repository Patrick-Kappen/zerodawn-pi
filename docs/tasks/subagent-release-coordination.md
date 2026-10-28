# Coordinate releases between agents before the final merge

Many agents release at the same time. Before the final merge, agents agree on order. One agent merges, tells the others, updates the flake and NixOS, and hands off to the owner.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md

## Original text

One step at a time. Each step is its own PR.

4. Coordination: before the final merge to main, check with the agents on other branches whether their release is ready or almost ready, or wait for "release after XYZ". One agent does the final merge and sends a message to all. On green: flake update and NixOS update on a worktree. Wait for a green PR, then a handoff to the owner.
