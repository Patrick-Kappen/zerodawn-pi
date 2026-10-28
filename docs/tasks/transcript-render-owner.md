# Decide which extension owns the tool call rendering in the transcript

Two extensions change how tool calls look: `bash` hides them and `ui` draws them in `/view compact`. Give this job to one extension, so the two do not fight.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- Decide who owns the transcript rendering of tool calls: `bash` hides every tool call and result (`ui/render.ts`), `ui` draws them in `/view compact`. One of them should own it.
