# Make core the owner of the run outcome

Each extension keeps its tools and works alone. `core` decides which stage runs, in which order, and when the run ends.

## Source

- User, 2026-10-29, zerodawn-pi session `2026-10-29T05-28-33-431Z_01a18621`: review of the overlap between extensions.

## Problem

- Five extensions handle `agent_before_settle`: `bash`, `checker`, `handoff`, `lsp`, `tests`. Each sees only a part of the open work. The result depends on the load order.
- `checker` asks only `bash` for open work. `handoff` reads the job files of `bash`. Neither sees test runs, LSP checks, opencode or subagents.
- `handoff` counts only a running job as open work. A job that ended, but whose report the agent did not get yet, does not stop a cut.
- `shared/chain.ts` splits a chain for the routes of `bash` and `tests` (#153). The wait guard and the quick check of `bash`, and the test detection of `tests`, still split with their own rule.
- The same change gets the same checks more than one time: tests after each edit, `just check`, `nix flake check`.
- The checker sends "Finish the task" when the agent asks the user for a choice.

## Stage order at the end of a run

1. Wait while work is open: bash jobs, test runs, LSP checks, opencode, subagents. Work stays open until the agent gets its report.
2. Format. This fixes files and needs no agent turn.
3. Lint and types, in one stage, with one report.
4. Tests.
5. Checker.
6. Done.

Rules:

- A failing stage stops the order. Core sends only that failure to the agent. The next stage does not start.
- A stage that passed for the same file state does not run again.
- A stage that does not apply does not run. Example: with no changed file, only the checker runs.
- When the agent asks the user for a choice, the run ends without the checker.
- Core sends the agent back a limited number of times per user message. Then the run ends with the open points.

## Steps, one PR each

1. Integration tests that lock the current behavior: the guards together, the routing between `tests` and `bash`, `checker` and `handoff` with open work. See [ci-refactor-tests](ci-refactor-tests.md).
2. A contract in `shared/`, with new exports only: events for work start, work end and stage result.
3. The wait guard and the quick check of `bash`, and the test detection of `tests`, use `splitChain`.
4. `core` only observes: it keeps the list of open work and logs the decision that it would make. The log must agree with the current decisions.
5. `checker` and `handoff` ask `core`. Each PR removes the old path.
6. `core` decides the end of the run and the stage order. The other extensions remove their `agent_before_settle` handlers.
7. Record the decision in `docs/decisions.md`. Update `README.md` and `AGENTS.md` of each changed extension.

## Related tasks

- [automatic-checks-plan](automatic-checks-plan.md): checks after file changes, commit and push.
- [local-check-repeats](local-check-repeats.md): repeated tests in local checks.
- [checker-continue-note](checker-continue-note.md): checker notes that start work the user did not ask for.
- [done-check-after-agent](done-check-after-agent.md): a done check after every agent.

## Done when

- Only `core` handles `agent_before_settle`.
- No extension reads the files or the state of another extension.
- A failing stage gives one message to the agent, and no later stage runs.
- A passed stage does not run again for the same file state.
- Tool names, parameters and outputs do not change.
