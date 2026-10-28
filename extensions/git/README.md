# git

## Tool

`git` — `action` (`status`, `diff`, `log`, `show`), `repo`, `ref`, `staged`, `paths`, `n`.

- `status`: porcelain, with directories of many files merged into one line.
- `diff` and `show` without `paths`: one line per file with `+added -deleted`, large directories merged. With `paths`: the patch with 1 line of context and without the `diff --git` headers.
- `log`: one line per commit, default 10, max 50.
- A result above 4000 characters goes to `<session>/out/<id>.git.log`; the result gives the path.

## Guard

`git status`, `git diff`, `git log` and `git show` in a bash command are blocked with a hint to use the tool. Add `# raw-git` to the bash command to run them anyway.

In a chain, bash runs such a part with the git command of the tool, and the part gets the compact output of the tool. The known options of the part go into the tool parameters: `--cached`, `-n 5`, `-5`, a ref, and the paths after `--`. Options that the tool replaces, such as `--short` or `--oneline`, have no effect. Another option refuses the chain with the `# raw-git` hint, and so do two refs without `--`. A part with shell syntax (pipe, quote, redirect, `$`) runs as written.

## Changes

<!-- changelog:start -->
## 0.6.0 — 2026-10-28

- tests: separate unit and integration suites

[All changes](CHANGELOG.md)
<!-- changelog:end -->
