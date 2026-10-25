# bash

Replaces pi's `bash` tool and adds `jobs`. Every command is a job in a PTY under `script`; state and output live under the session directory (`shared/store.ts`). `tool/` runs jobs, `ui/` draws them, `screen/` turns PTY bytes into lines. Limits and intervals are constants in `config.ts`; change them there, not inline. The PTY tests need `script` and bash; they run in the nix sandbox too.
