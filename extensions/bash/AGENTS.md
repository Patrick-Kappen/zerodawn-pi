# bash

- Every command is a job without a terminal, with stdin from `/dev/null` (decision 6). Do not add a terminal.
- Change limits and intervals in `config.ts`, not inline.
- Keep job state and output under the session directory, through `shared/store.ts`.
- The job tests must pass in the Nix sandbox too.
