# files

Registers pi's `read`, `edit` and `write` tools again with shorter descriptions and prompt guidelines, and an own `grep` tool on ripgrep.

## Changes

- `read`: a file over 200 lines without `offset` and `limit` gives an outline with line numbers: headings for Markdown, declarations for code (ts/js, py, sh, nix, go, rs, lua, yaml, json, toml, justfile). A file type without a rule gives the first 200 lines.
- `read` and `grep`: a path `out:<name>` is the output `<session>/out/<name>.txt`, else `<name>.log`, of a tool call in this session. An unknown name fails with the next step.
- `read`: `limit` is capped at 200 lines, and the output at 16 KB. The note names the next `offset`. `offset=-N` gives the last N lines.
- `read`: lines that are unchanged and still in the model context are not sent again. read, edit and write store line hashes of the lines they show in `details.seen`. A read checks the results in the current model context (after prune and compaction) and finds those lines in the file again, also when an edit moved them. A range with no new lines gives one line of text.
- bash: the block of `grep`/`rg` sends the model to the grep tool and its options; other viewers go to grep and read.
- bash: a file viewer whose output goes to the model is blocked: `cat`, `head`, `tail`, `less`, `more`, `nl`, `bat`, `sed -n` and `grep`/`rg` with a file argument, also when piped into other viewers. A redirect to a file, `tail -f`, `grep -l/-c/-q` and a pipe into another program are allowed.
- `edit` and `write`: a syntax check with tree-sitter in headless nvim, for ts, tsx, js, nix, sh, py, lua, yaml and json. A change that adds a syntax error is undone, and the error shows the new errors with the lines around them. Errors that the old content had too do not count. A missing nvim or grammar fails the tool with the Home Manager option to set (`nvim`, `treesitterGrammars`). `config.json`: `nvim` (default `nvim` from `PATH`) and `treesitterParsers`.
- `edit` and `write`: after a change without new syntax errors, the formatter of the project formats the file: biome when a `biome.json(c)` is in a directory up to the repository root (`node_modules/.bin/biome` or `biome` from `PATH`), nixfmt for `.nix` when the root `flake.nix` names nixfmt, ruff for `.py` with a `ruff.toml` or `[tool.ruff]` in `pyproject.toml`. A project without such a config is not formatted. A configured formatter that is not installed fails the tool before the change. A formatter that fails after the change fails the tool with its output. When the formatter changed the file, the result says so.
- `edit`: when `oldText` is not found, the tool looks for the same lines with other indentation. One unique match: the edit is applied with the file's indentation, and the result says so. No match: the error shows the most similar place in the file, with line numbers.
- `edit`: the result ends with the current lines around each change, so the model does not read the file again.
- `write`: blocked on an existing file of more than 100 lines. Use `edit`, or remove the file first.
- `grep`: runs `rg` from `PATH`, sorted by path. It searches hidden files but not `.git/`, and respects `.gitignore` unless `noIgnore`. Max 20 matches per file in a directory search, and 100 result lines in total (`limit`); a note names the cut. Options: `glob`, `type`, `ignoreCase`, `literal`, `multiline`, `context`, `filesOnly` (paths), `count` (lines per file). Lines are cut at 200 characters.
- `codemode`: a result above 2000 lines or 16 KB is cut. The full text goes to `<session>/out/<id>.codemode.log`.

## Constants

`lib/files.ts`: `WRITE_MAX_LINES`. `lib/grep.ts`: `GREP_LINE_MAX`, `GREP_LIMIT`, `GREP_PER_FILE`. `lib/read.ts`: `READ_MAX_LINES`, `READ_MAX_BYTES`. `lib/outline.ts`: `OUTLINE_MAX`. `index.ts`: `MAX_BYTES`.

## Changes

<!-- changelog:start -->
## 0.3.0 — 2026-10-27

- edit and write run the formatter of the project

- edit and write undo a change that adds a syntax error

- read sends only new lines; bash blocks file views

[All changes](CHANGELOG.md)
<!-- changelog:end -->
