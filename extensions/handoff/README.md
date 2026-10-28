# handoff

`/handoff` writes a handoff card and starts a new session with it. `/handoff card` only writes the card and shows it.

| Step | What |
|---|---|
| Transcript | `lib/transcript.ts` strips the session since the previous card: one line per user or assistant text (max 500 characters), one line per tool call with the first line of its result. No tool output, no thinking. |
| Card | A model of `handoffModels` in `config.json` gets the facts, the previous card and the transcript, and calls the one tool `write_card`. The first model with auth, a valid call and a valid card wins; the error lists every failed model. |
| Card fields | goal, status (active or done), waitsForUser (true when the last agent message asks the user something), inProgress (max 3, the half-done step and where to go on), state (max 5, each the state now and the state it must have), next (1 to 3 concrete actions), merged (max 5 PRs that the next actions depend on), open (max 5, with place and blocker), decisions (max 3), avoid (max 3). |
| Facts | The code adds them: the active NixOS system and its config revision, branch, dirty files, worktrees with their branch, open PRs of the user in the repository, with branch and check status (`gh`), and bash jobs without a report. A failing command gives a line with its error. |
| Handoff | The card, the facts and the path of the session. No transcript lines. Max 8000 characters. |
| Files | `<session>/handoff/<n>.json`: card, model, facts, text and the last entry id. The next card starts after that entry. |

`/handoff` starts the new session with the session as parent and the handoff as the first message. The file can also go to another agent as its task.

## Updates

The card is updated in the background, so the state is there when a handoff comes:

- After a run (`agent_end`), when the stripped transcript since the last card has 20000 characters or more, or the run had a successful `git commit`, `git push`, `gh pr create` or `gh pr merge` in bash. A notification names the reason and the model; a failure is an error notification.
- On `/quit` and `/new`, when there is something new since the last card. Pi waits for this update before it stops.
- One update at a time. `/handoff` waits for a running update.

A command that moved to the background (over 15 s) does not count: its tool result says only that the job runs. The next trigger catches its effect.

## Context limit

The extension keeps the context between about 100k and 150k tokens:

| When | What |
|---|---|
| `turn_end`, from 130k and again from 140k | One system warning per level, visible in the chat: `System: context 87%; 19k tokens left. Continue working or call handoff for an early handoff.` The percentage and the tokens left refer to the cut at 150k. |
| `turn_end` from 150k, or after the tool `handoff`; the turn had tool calls, no bash job runs | Cut in the middle of the work: a `compaction` with `firstKeptEntryId: null` makes the handoff the whole context, and a system message tells the agent to go on with In progress and Next 1. |
| End of a run (`agent_before_settle`), from 150k, after a warning or after the tool `handoff`, no bash job runs | Cut after the final answer: the `compaction` keeps the last assistant message, so the answer stays in the chat and in the context. The run continues only when another extension asks for it, for example a checker follow-up. |
| End of a run from 150k while a bash job runs | No cut yet: the job report starts a new run, and the cut comes at its end. |
| `turn_end` from 170k | Hard cut in the middle of a run, then a system message to continue with the Next step of the handoff. |
| Cache warming, under 100k while a bash job runs | Pi's decision becomes `warm`; pi stops warming after 30 idle minutes. |

A notification names each cut and the handoff file. A failing card write is an error, and the context stays as it is. When the background update already wrote the card up to the last entry, the cut uses that card. The handoff adds its entries after the entries of other extensions at the same boundary.

The tool `handoff` has no parameters. The agent calls it for an early handoff; its result says when the cut comes.

## recall

The tool `recall { question, session? }` answers one question about earlier work, also the part before a cut, which stays in the session file. `session` is a `.jsonl` path, for example the one under "Earlier work" in a handoff; the default is this session.

- The session becomes a stripped transcript with the entry id in front of each line. User and assistant text keep up to 2000 characters per message here, against 500 for the card, because recall is about details.
- When it is larger than 200000 characters, code keeps the chunks of 40 lines with the most words of the question, in their order, with `[…]` between gaps.
- A model of `handoffModels` answers in a few lines with entry ids, or "Not in the transcript.". The first model with auth and a non-empty answer wins.

## Constants

`index.ts`: `RECENT_MAX_CHARS`. `lib/triggers.ts`: `UPDATE_CHARS`. `lib/decider.ts`: `WARN_AT`, `CUT_AT`, `HARD_AT`, `WARM_BELOW`. `lib/recall.ts`: `RECALL_MAX_CHARS`, `RECALL_TEXT_MAX`. `lib/card.ts`: `LIMITS`, `HANDOFF_MAX_CHARS`. `lib/summarize.ts`: `TRANSCRIPT_MAX_CHARS`. `lib/transcript.ts`: `TEXT_MAX`.

## Changes

<!-- changelog:start -->
## 0.4.0 — 2026-10-28

- remove the reused card fixture after tests

- tests: separate unit and integration suites

- tests: clean fixtures and isolate the supervisor environment

[All changes](CHANGELOG.md)
<!-- changelog:end -->
