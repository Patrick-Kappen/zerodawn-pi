# Stop full local checks from repeating tests

Local checks run some tests twice, through recipes and through Nix. Stage 4 of the CI plan covers this.

## Source

- zerodawn-pi branch tests/separate-suites (PR #121): docs/test-separation.md (Boundary)

## Original text

This delivery does not change CI scheduling, merge protection, release automation, or NixOS outputs.
Full local checks still repeat tests through direct recipes and Nix. Step 4 addresses that work.
The known NixOS output warnings remain documented in [the baseline](ci-baseline.md).
