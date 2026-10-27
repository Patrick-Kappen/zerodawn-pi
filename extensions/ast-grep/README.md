# ast-grep

## Tool

`ast_grep` — `pattern`, `lang`, `path`, `globs`, `rewrite`.

Structural code search with [ast-grep](https://ast-grep.github.io): the pattern is code in the target language, `$NAME` matches one node, `$$$` matches zero or more. `rewrite` previews a replacement; it never writes files. Output is grouped per file as `line: first line of match`, cut at pi's output limit; the full output then goes to a temp file.

## Config

`astGrep` in `config.json`: path of the `ast-grep` binary. Without it, `ast-grep` from `PATH`. The Nix module sets it from `programs.zerodawn-pi.astGrep` (default `pkgs.ast-grep`).

## Layout

`lib/format.ts`: the output format. The tests cover it.

## Changes

<!-- changelog:start -->
## 0.3.0 — 2026-10-27

- docs: open points of 2026-10-27 in the TODO files

- core: each tool rule in one place, description or parameter

- core: workflow prompt replaces pi rules; tool descriptions complete

[All changes](CHANGELOG.md)
<!-- changelog:end -->
