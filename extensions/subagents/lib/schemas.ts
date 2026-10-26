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

export const MAX_SUMMARY = 200;

export const handoffSchema = Type.Object({
  summary: Type.String({ minLength: 1, maxLength: MAX_SUMMARY, description: `What works now, in one sentence. Max ${MAX_SUMMARY} characters.` }),
  change: Type.Union([Type.Literal("fix"), Type.Literal("feature"), Type.Literal("breaking")], {
    description: "The kind of change for the commit trailer: fix (no new behaviour), feature (new behaviour, old use works), breaking (old use stops working).",
  }),
  changes: Type.Array(Type.Object({ file: Type.String({ minLength: 1 }), what: Type.String({ minLength: 1 }) }), {
    description: "One entry for each changed file, as git shows it: the file and what changed in it. Empty when no file changed.",
  }),
  tests: Type.Array(Type.Object({ file: Type.String({ minLength: 1 }), covers: Type.String({ minLength: 1 }) }), {
    description: "The test files that you added or changed and what each covers. An empty list is allowed.",
  }),
  findings: Type.Array(Type.String({ minLength: 1 }), {
    description: "One fact in each entry, with path:line where it applies. At least one when no file changed; else an empty list is allowed.",
  }),
  decisions: Type.Array(Type.String(), { description: "Decisions that the task did not fix. An empty list is allowed." }),
  open: Type.Array(Type.String(), { description: "What is still open. An empty list is allowed." }),
  next: Type.String({ description: "The next step. Empty when nothing is open." }),
  risks: Type.Array(Type.String(), { description: "Known risks. An empty list is allowed." }),
});

export const doneSchema = Type.Object({});

export const continueSchema = Type.Object({});
