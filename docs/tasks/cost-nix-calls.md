# Decrease the repeated nix develop/build/eval calls

Agents ran nix commands about 475 times. Script the frequent ones.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

  - Nix: `nix develop/build/eval/flake` about 475 times.
