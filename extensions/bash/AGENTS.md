# bash

Replaces pi's `bash` tool and adds `jobs`. Every command is a job without a terminal, stdin from `/dev/null` (decision 6); state and output live under the session directory (`shared/store.ts`). `tool/` runs jobs, `ui/` draws them, `screen/` turns raw output into lines. Limits and intervals are constants in `config.ts`; change them there, not inline. The job tests need bash; they run in the nix sandbox too.
