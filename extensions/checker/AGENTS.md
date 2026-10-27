# checker

- Keep the decision in `decide()`. The classifier only answers questions.
- Never send more than `MAX_FOLLOWUPS` follow-ups per user message. A tool call does not reset the count.
- A text-only answer after a follow-up is a rebuttal: stop, check no further.
- A failed classify call gives a visible warning and no follow-up.
- A new setting is an environment variable. Document it at the top of `index.ts` and in `README.md`.
