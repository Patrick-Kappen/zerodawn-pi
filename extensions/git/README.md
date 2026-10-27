# git

## Tool

`git` — `action` (`status`, `diff`, `log`, `show`), `repo`, `ref`, `staged`, `paths`, `n`.

- `status`: porcelain, with directories of many files merged into one line.
- `diff` and `show` without `paths`: one line per file with `+added -deleted`, large directories merged. With `paths`: the patch with 1 line of context and without the `diff --git` headers.
- `log`: one line per commit, default 10, max 50.
- A result above 4000 characters goes to `<session>/out/<id>.git.log`; the result gives the path.

## Guard

`git status`, `git diff`, `git log` and `git show` in a bash command are blocked with a hint to use the tool. Add `# raw-git` to the bash command to run them anyway.

## Changes

<!-- changelog:start -->
## 0.5.0 — 2026-10-27

- core: workflow prompt replaces pi rules; tool descriptions complete

[All changes](CHANGELOG.md)
<!-- changelog:end -->
