# Add a test environment for the exact setup

Live tests now run on the real system. They can commit, change `main` or change the behaviour of the running system. Make an environment with the exact setup that is safe to break.

## Source

- User, 2026-10-29

## Original text

- Have an actual test environment where we can test the exact setup while not committing or changing main system behaviour (NixOS VM?).

## To do

- Research a NixOS VM (`nixos-rebuild build-vm` or a `nixosTest`) with the same Home Manager config, pi version and extensions.
- Compare with the options that exist: `just dev` (tmux sandbox), a container, nullspace.
- The environment must have its own git remote or a copy, so a test cannot push to the real repositories.
- It must give the model auth without the real SSH keys.
- Use it for the live checks: pi-p-background-job, run-tests-other-devshell, message-end-sendmessage, recall.
