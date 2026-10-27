# handoff

`/handoff` writes a handoff card and starts a new session with it. `/handoff card` only writes the card and shows it.

| Step | What |
|---|---|
| Transcript | `lib/transcript.ts` strips the session since the previous card: one line per user or assistant text (max 500 characters), one line per tool call with the first line of its result. No tool output, no thinking. |
| Card | A model of `handoffModels` in `config.json` gets the previous card and the transcript, and calls the one tool `write_card`. The first model with auth, a valid call and a valid card wins; the error lists every failed model. |
| Card fields | goal, status (active or done), decisions (max 5), open (max 5), next, avoid (max 3), done (max 10, one line per PR or commit that the next step still needs). |
| Facts | The code adds them: branch, dirty files, worktrees, open PRs of the user (`gh`), and bash jobs without a report. A failing command gives a line with its error. |
| Handoff | The card, the facts, the last lines of the transcript (max 6000 characters) and the path of the session. Max 32000 characters. |
| Files | `<session>/handoff/<n>.json`: card, model, facts, recent lines, text and the last entry id. The next card starts after that entry. |

`/handoff` starts the new session with the session as parent and the handoff as the first message. The file can also go to another agent as its task.

## Updates

The card is updated in the background, so the state is there when a handoff comes:

- After a run (`agent_end`), when the stripped transcript since the last card has 20000 characters or more, or the run had a successful `git commit`, `git push`, `gh pr create` or `gh pr merge` in bash. A notification names the reason and the model; a failure is an error notification.
- On `/quit` and `/new`, when there is something new since the last card. Pi waits for this update before it stops.
- One update at a time. `/handoff` waits for a running update.

A command that moved to the background (over 15 s) does not count: its tool result says only that the job runs. The next trigger catches its effect.

## Constants

`index.ts`: `RECENT_MAX_CHARS`. `lib/triggers.ts`: `UPDATE_CHARS`. `lib/card.ts`: `LIMITS`, `HANDOFF_MAX_CHARS`. `lib/summarize.ts`: `TRANSCRIPT_MAX_CHARS`. `lib/transcript.ts`: `TEXT_MAX`.

## Changes

<!-- changelog:start -->
<!-- changelog:end -->
