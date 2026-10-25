# files

Registers pi's `read`, `grep`, `edit` and `write` tools again with shorter descriptions and prompt guidelines.

## Changes

- `edit`: when `oldText` is not found, the tool looks for the same lines with other indentation. One unique match: the edit is applied with the file's indentation, and the result says so. No match: the error shows the most similar place in the file, with line numbers.
- `edit`: the result ends with the current lines around each change, so the model does not read the file again.
- `write`: blocked on an existing file of more than 100 lines. Use `edit`, or remove the file first.
- `grep`: lines are cut at 200 characters.
- `codemode`: a result above 2000 lines or 16 KB is cut. The full text goes to `<session>/out/<id>.codemode.log`.

## Constants

`lib/files.ts`: `WRITE_MAX_LINES`, `GREP_LINE_MAX`. `index.ts`: `MAX_BYTES`.

## Changes

<!-- changelog:start -->
No release yet.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
