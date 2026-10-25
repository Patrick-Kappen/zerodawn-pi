# ast-grep

## Tool

`ast_grep` — `pattern`, `lang`, `path`, `globs`, `rewrite`.

Structural code search with [ast-grep](https://ast-grep.github.io): the pattern is code in the target language, `$NAME` matches one node, `$$$` matches zero or more. `rewrite` previews a replacement; it never writes files. Output is grouped per file as `line: first line of match`, cut at pi's output limit; the full output then goes to a temp file.

## Config

`astGrep` in `config.json`: path of the `ast-grep` binary. Without it, `ast-grep` from `PATH`. The Nix module sets it from `programs.zerodawn-pi.astGrep` (default `pkgs.ast-grep`).

## Changes

<!-- changelog:start -->
## 0.1.0 — 2026-10-25

- First release.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
