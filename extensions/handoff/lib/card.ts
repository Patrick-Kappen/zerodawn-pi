import { Type } from "typebox";

export const LIMITS = { line: 200, goal: 300, decisions: 5, open: 5, avoid: 3, done: 10 };
export const HANDOFF_MAX_CHARS = 32_000;

export type Card = {
  goal: string;
  status: "active" | "done";
  decisions: string[];
  open: string[];
  next: string;
  avoid: string[];
  done: string[];
};

const line = (description: string) => Type.String({ maxLength: LIMITS.line, description });
const list = (max: number, description: string) => Type.Array(line(""), { maxItems: max, description });

export const CARD_PARAMETERS = Type.Object({
  goal: Type.String({ maxLength: LIMITS.goal, description: "The goal of the user, in their words." }),
  status: Type.Union([Type.Literal("active"), Type.Literal("done")], { description: "done when the goal is reached and nothing is open." }),
  decisions: list(LIMITS.decisions, "Decisions that still count, each with its reason."),
  open: list(LIMITS.open, "Work that is not done yet."),
  next: line("The next concrete step."),
  avoid: list(LIMITS.avoid, "Options that were tried or rejected, with the reason."),
  done: list(LIMITS.done, "One line per PR or commit that the next step still needs. Leave out work that is merged and finished."),
});

const isLine = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isList = (v: unknown, max: number) => Array.isArray(v) && v.length <= max && v.every((x) => isLine(x, LIMITS.line));

export function checkCard(raw: unknown): Card {
  const c = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null) throw new Error("write_card: the arguments are not an object.");
  if (!isLine(c.goal, LIMITS.goal)) problems.push(`goal: 1 to ${LIMITS.goal} characters`);
  if (c.status !== "active" && c.status !== "done") problems.push('status: "active" or "done"');
  if (!isLine(c.next, LIMITS.line)) problems.push(`next: 1 to ${LIMITS.line} characters`);
  for (const key of ["decisions", "open", "avoid", "done"] as const) {
    if (!isList(c[key], LIMITS[key])) problems.push(`${key}: at most ${LIMITS[key]} lines of 1 to ${LIMITS.line} characters`);
  }
  if (problems.length) throw new Error(`write_card: invalid card: ${problems.join("; ")}.`);
  return raw as Card;
}

const section = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((i) => `- ${i}`)] : []);

export function render(card: Card, facts: string[], recent: string[], source: string): string {
  const text = [
    "# Handoff",
    `Goal: ${card.goal}`,
    `Status: ${card.status}`,
    `Next: ${card.next}`,
    ...section("Decisions", card.decisions),
    ...section("Open", card.open),
    ...section("Avoid", card.avoid),
    ...section("Done", card.done),
    ...section("State", facts),
    ...section("Last actions", recent),
    `Earlier work: ${source}`,
  ].join("\n");
  if (text.length > HANDOFF_MAX_CHARS)
    throw new Error(`handoff: the text has ${text.length} characters, more than ${HANDOFF_MAX_CHARS}. Decrease the recent lines.`);
  return text;
}
