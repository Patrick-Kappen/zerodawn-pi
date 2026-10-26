import { Type } from "typebox";

export const MAX_QUESTION = 500;

export const askSchema = Type.Object({
  question: Type.String({ maxLength: MAX_QUESTION, description: `The question for the main agent. Max ${MAX_QUESTION} characters.` }),
});

export const blockerSchema = Type.Object({
  issue: Type.String({ minLength: 1, description: "What blocks you." }),
  files: Type.Array(Type.String(), { description: "The files that matter for the blocker. An empty list is allowed." }),
  tried: Type.Array(Type.String(), { minItems: 1, description: "What you tried to solve it. At least one entry." }),
});

export const handoffSchema = Type.Object({
  done: Type.Array(Type.String(), { description: "What is done." }),
  open: Type.Array(Type.String(), { description: "What is open." }),
  next: Type.String({ minLength: 1, description: "The next step." }),
  files: Type.Array(Type.String(), { description: "The files you changed." }),
  risks: Type.Array(Type.String(), { description: "Known risks." }),
  tests: Type.String({ minLength: 1, description: "The state of the tests." }),
});

export const MAX_SUMMARY = 200;

const summary = Type.String({ minLength: 1, maxLength: MAX_SUMMARY, description: `What works now, in one sentence. Max ${MAX_SUMMARY} characters.` });

export const doneSchema = Type.Object({
  summary,
  changes: Type.Array(Type.Object({ file: Type.String({ minLength: 1 }), what: Type.String({ minLength: 1 }) }), {
    minItems: 1,
    description: "One entry for each changed file, as git shows it: the file and what changed in it.",
  }),
  tests: Type.Array(Type.Object({ file: Type.String({ minLength: 1 }), covers: Type.String({ minLength: 1 }) }), {
    description: "The test files that you added or changed and what each covers. An empty list is allowed.",
  }),
  decisions: Type.Array(Type.String(), { description: "Decisions that the task did not fix. An empty list is allowed." }),
  open: Type.Array(Type.String(), { description: "What is still open. An empty list is allowed." }),
});

export const doneFindingsSchema = Type.Object({
  summary,
  findings: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    description: "One fact in each entry. Add path:line where it applies.",
  }),
});
