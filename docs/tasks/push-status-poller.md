# Add a poller that reports PR checks, merge, tags and flake update

After a push the user checks the status by hand. A poller watches checks, merge, tags and the flake update. Green gives a small notice, red gives only the error.

## Source

- zerodawn-pi main: docs/todo.md (Backlog)

## Original text

- A poller for the status after a push. It watches the PR checks, the merge, the release tags and `nix flake update` in nixos-config, and reports on its own: green as a small notification (active or in the history, to be decided), red with the error and nothing else. No more asking or checking by hand.
