# Give line numbers in read and write, and force read before edit

Only edit gives line numbers. With line numbers in read, edits can be line-based and span many files.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Files: edit returns the changed lines with line numbers; write and read (outside the outline) give none. Force a read before an edit, with line-based and multi-file edits; read then must give line numbers.
- Edit rework is rare: 25 of 540 tasks with edits change one file 4 times or more.
