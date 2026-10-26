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
