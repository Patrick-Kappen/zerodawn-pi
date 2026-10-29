# Parse bash commands with one tree-sitter parser

Six places parse a bash command, each with its own regex or scanner. They do not agree on quotes, heredocs and redirects. Use one parser for all of them.

## Problem

| Place | Logic |
|---|---|
| `shared/chain.ts` `splitChain` | own scanner for separators, blocks and heredocs |
| `shared/util.ts` `stripQuoted` | regex for quotes and heredocs |
| `extensions/files/lib/route.ts` | `shellWords`, a regex for `> path`, a regex for the heredoc |
| `extensions/git/lib/route.ts` | a regex for shell characters, then a split at spaces |
| `extensions/bash/tool/quick.ts`, `guard.ts` | `stripQuoted`, then a regex split at `&&`, `\|\|`, `;` |
| `extensions/tests/lib/recipes.ts` | `stripQuoted`, a regex for the command position and for `bash -c` |

## Decision

Use `web-tree-sitter` with the `tree-sitter-bash` grammar (wasm). Measured on 2026-10-29: one load of 11 ms, then 0.03 ms for each parse, in node and in bun.

- In process and synchronous after the load: bash, files, git, tests and the guards each parse the same command.
- Unit tests stay without processes: the wasm file is a static fixture read.
- Each node has byte offsets, so a route can use the original text of a part.
- A command with a syntax error gives `hasError`. Then it runs as written, and bash gives the real error.
- Not `shfmt --to-json`: a process for each parse (9 ms), and unit tests cannot run it.
- Not an own parser: it covers only the shapes that we write.

## Plan

1. Add `web-tree-sitter` and `tree-sitter-bash` with Nix packaging, as for pi-tui-kit (`nix/<name>/` with a lock file). Add the same packaging to zerodawn-pi-private (`just sync-check`).
2. Add `shared/shell.ts`: load the grammar once, and give a command model: parts with separators, simple commands with words (with quote and expansion information), redirects and heredoc bodies.
3. Use the model in `splitChain` (same signature and tests), in the file and git routes, in `isQuick`, `waitsOnly`, and `isTest`/`isCheck`.
4. Send `sed -i` to edit on top of the model ([task](cost-sed-to-edit.md)).

## Done when

- One parser module reads bash commands; the six places above use it.
- The existing route, chain, quick, guard and recipe tests pass without changes to their expectations.
- `just check` and `just sync-check` pass.

## Source

- Session 2026-10-29, after PR #154: "everything is using different regex logic. I think ast parsers and unified tools would help a lot?"
