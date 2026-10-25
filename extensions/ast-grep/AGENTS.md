# ast-grep

Registers the `ast_grep` tool; wraps the `ast-grep` binary from `config.json` (`astGrep`) or `PATH`. Pure formatting lives in `lib/format.ts` and is what the tests cover. Keep the tool read-only: `rewrite` previews, never writes.
