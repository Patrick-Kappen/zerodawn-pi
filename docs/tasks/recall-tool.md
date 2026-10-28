# Refactor recall into a memory system

`recall` exists, but it is only a first step. The user asked for a recall tool and also said that a real memory system is necessary. The current tool does not give that. Refactor it.

## Source

- zerodawn-pi main: TODO.md
- Review of 2026-10-29

## Original text

- `recall`: one question about an old session; a cheap model searches its stripped transcript and returns a short answer with entry ids. Later maybe long-term memory.

## Current state

- Commit "handoff: recall answers a question about an earlier session". The code is in `extensions/handoff/lib/recall.ts` and the `recall` tool in `extensions/handoff/index.ts`.
- One call reads one `.jsonl` file: the current session, or the path in `session`.
- It strips the transcript to one line per entry and sends it with the question to the first model of `handoffModels`.
- Above 200,000 characters it keeps blocks of 40 lines with the most words from the question.

## Problems found (tested on 2026-10-29)

- It reads all branches of the file. A test session with two branches gave a quote from the branch that the user left. Follow the `parentId` chain from the last entry.
- The selection is a plain word match. A question with other words than the transcript can miss the right block.
- It searches only one file. The agent must know the path, for example from `Earlier work:` on the handoff card.
- It has no memory across sessions or projects: no store of decisions, facts or mistakes.
- The answer comes in the language of the session, not in the language of the rules.

## To do

- Design a memory system first: what it stores, when it writes, how an agent asks, and the scope (session, project, user).
- Decide if recall stays a tool on top of that system, or if the system replaces it.
- Keep the working parts: cheap model, stripped transcript, entry ids as evidence.
- Fix the branch problem in any version.
