# tests

Registers the tool `run_tests`, blocks test commands in bash and runs `run_tests` in their place, puts justfile and Makefile recipes in the system prompt, and hints to add a long repeated command as a recipe. Needs `git`, and `just` in `PATH` for a justfile project; fails loud without them.

- `lib/run.ts`: the tool without its schema (`RunTests`, `plan`, `changedFiles`). `index.ts` registers it with the TypeBox schema.
- `lib/select.ts`: picks the test files through the relative imports, and finds the changed files without a test.
- `lib/report.ts`: makes the bun output short.

After a pi upgrade: make sure that a tool result with `isError: true` still shows as an error, that `tool_call` still blocks the bash calls of codemode, and that pi still waits for an async `tool_call` handler.
