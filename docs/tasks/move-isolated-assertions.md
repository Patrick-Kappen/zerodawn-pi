# Move isolated assertions out of the mixed integration files

Some unit-like assertions are still in integration files. Move them to the unit suite.

## Source

- zerodawn-pi branch tests/separate-suites (PR #121): docs/test-separation.md (Boundary)

## Original text

Mixed integration files still contain some isolated assertions. Moving those assertions later does not require a behavior change.
