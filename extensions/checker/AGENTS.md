# checker

- Keep the decision in `decide()`. The classifier only answers questions.
- Never continue more than `MAX_FOLLOWUPS` times in a row without a tool call in between.
- A failed classify call gives a visible warning and no follow-up.
- A new setting is an environment variable. Document it at the top of `index.ts` and in `README.md`.
