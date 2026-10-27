import { Type } from "typebox";

export const LIMITS = { line: 160, goal: 200, state: 5, next: 3, merged: 5, open: 5, decisions: 3, avoid: 3 };
export const HANDOFF_MAX_CHARS = 8_000;

export type StateLine = { now: string; target: string };
export type Card = {
  goal: string;
  status: "active" | "done";
  state: StateLine[];
  next: string[];
  merged: string[];
  open: string[];
  decisions: string[];
  avoid: string[];
};

const LISTS = ["next", "merged", "open", "decisions", "avoid"] as const;

const line = (description: string) => Type.String({ maxLength: LIMITS.line, description });
const list = (max: number, description: string) => Type.Array(line(""), { maxItems: max, description });

export const CARD_PARAMETERS = Type.Object({
  goal: Type.String({ maxLength: LIMITS.goal, description: "The goal of the user, in one sentence." }),
  status: Type.Union([Type.Literal("active"), Type.Literal("done")], { description: "done when the goal is reached and nothing is open." }),
  state: Type.Array(
    Type.Object({
      now: line("The current state of one system, repository, branch or deployment. Use the facts."),
      target: line("The state that it must have when the goal is reached. Same as now when it is correct."),
    }),
    { maxItems: LIMITS.state, description: "Only the states that the next steps change or depend on." },
  ),
  next: Type.Array(line(""), {
    minItems: 1,
    maxItems: LIMITS.next,
    description: "The next concrete actions in order, each one command or one change. No alternatives.",
  }),
  merged: list(LIMITS.merged, '"#<nr> <title>" of the merged PRs that the next steps depend on. Leave out finished history.'),
  open: list(LIMITS.open, "Work that is not merged: where it is (PR number, branch or file) and what blocks it."),
  decisions: list(LIMITS.decisions, "Decisions that still count for the open work, each with its reason."),
  avoid: list(LIMITS.avoid, "Approaches that failed and must not be tried again, with the reason."),
});

const isLine = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isList = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => isLine(x, LIMITS.line));
const isState = (v: unknown) =>
  Array.isArray(v) &&
  v.length <= LIMITS.state &&
  v.every((s) => typeof s === "object" && s !== null && isLine(s.now, LIMITS.line) && isLine(s.target, LIMITS.line));

export function checkCard(raw: unknown): Card {
  const c = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null) throw new Error("write_card: the arguments are not an object.");
  if (!isLine(c.goal, LIMITS.goal)) problems.push(`goal: 1 to ${LIMITS.goal} characters`);
  if (c.status !== "active" && c.status !== "done") problems.push('status: "active" or "done"');
  if (!isState(c.state)) problems.push(`state: at most ${LIMITS.state} objects with now and target of 1 to ${LIMITS.line} characters`);
  for (const key of LISTS) {
    if (!isList(c[key], LIMITS[key])) problems.push(`${key}: at most ${LIMITS[key]} lines of 1 to ${LIMITS.line} characters`);
  }
  if (Array.isArray(c.next) && c.next.length === 0) problems.push("next: at least 1 action");
  if (problems.length) throw new Error(`write_card: invalid card: ${problems.join("; ")}.`);
  return raw as Card;
}

const section = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((i) => `- ${i}`)] : []);
const stateLine = (s: StateLine) => (s.now === s.target ? `${s.now} (correct)` : `now: ${s.now} → must be: ${s.target}`);

export function render(card: Card, facts: string[], source: string): string {
  const text = [
    "# Handoff",
    `Goal: ${card.goal}`,
    `Status: ${card.status}`,
    "Next:",
    ...card.next.map((n, i) => `${i + 1}. ${n}`),
    ...section("State", card.state.map(stateLine)),
    ...section("Open", card.open),
    ...section("Merged", card.merged),
    ...section("Decisions", card.decisions),
    ...section("Avoid", card.avoid),
    ...section("Facts", facts),
    `Earlier work: ${source}`,
  ].join("\n");
  if (text.length > HANDOFF_MAX_CHARS) throw new Error(`handoff: the text has ${text.length} characters, more than ${HANDOFF_MAX_CHARS}. Decrease the facts.`);
  return text;
}
