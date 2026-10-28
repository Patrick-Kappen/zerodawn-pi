# Stop the checker note from starting work that the user did not ask for

The checker sends a note after a turn ("checker: - Do the check that you left open."). The agent then starts to fix things before it answers the user, or before it asks if the fix is wanted. This also occurs when the agent had nothing to finish.

## Source

- User, 2026-10-28, nixos-config session `2026-10-28T20-06-58-577Z_01a1841f`.

## Original text

- "The continue note needs to go different, cause now the agent starts fixing stuff even before he answered me or asked if it needed fixing. He did not had anything to finish right there."

## Seen in that session

- The user only asked to see the handoff. The agent showed it and reported a defect that it found, but did not check the cause.
- The checker sent "Do the check that you left open." The agent then made a branch, changed code, opened PR #136, and ran checks. The user did not ask for a fix.
- A second note, "Fix the error in scope.", sent the agent to a flaky test that had no relation to the request.

## Done when

- A note does not start a change that is outside the user request.
- When the agent offers a fix that the user did not ask for, the checker lets the turn end, so the user can decide.
- A test covers a turn that only answers a question and reports a side finding.
