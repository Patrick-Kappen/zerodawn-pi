# Show an overview in window 0, with socket errors

Window 0 must show all subagents. Socket errors now disappear; show them there.

## Source

- zerodawn-pi main: extensions/subagents/TODO.md

## Original text

One step at a time. Each step is its own PR.

11. Overview in window 0.
    - Show client socket errors there; `lib/server.ts` now drops them with `socket.destroy()`.
