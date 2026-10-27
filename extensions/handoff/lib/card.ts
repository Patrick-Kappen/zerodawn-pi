import { Type } from "typebox";

export const LIMITS = { line: 160, goal: 200, inProgress: 3, state: 5, next: 3, merged: 5, open: 5, decisions: 3, avoid: 3 };
export const HANDOFF_MAX_CHARS = 8_000;

export type StateLine = { now: string; target: string };
export type Card = {
  goal: string;
  status: "active" | "done";
  waitsForUser: boolean;
  inProgress: string[];
  state: StateLine[];
  next: string[];
  merged: string[];
  open: string[];
  decisions: string[];
  avoid: string[];
};

const LISTS = ["inProgress", "next", "merged", "open", "decisions", "avoid"] as const;

const line = (description: string) => Type.String({ maxLength: LIMITS.line, description });
const list = (max: number, description: string) => Type.Array(line(""), { maxItems: max, description });

export const CARD_PARAMETERS = Type.Object({
  goal: Type.String({ maxLength: LIMITS.goal, description: "The goal of the user, in one sentence." }),
  status: Type.Union([Type.Literal("active"), Type.Literal("done")], { description: "done when the goal is reached and nothing is open." }),
  waitsForUser: Type.Boolean({
    description: "true only when the last agent message asks the user a question or a decision, or the goal is done. false when the agent can go on alone.",
  }),
  inProgress: list(
    LIMITS.inProgress,
    "The step that the agent was in the middle of: what is half done and the exact point to go on (file, command, job id). Empty when no step is half done.",
  ),
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
    description:
      "The next actions in order. Each names the exact command, file, PR or branch, so the next agent can start at once. No alternatives, no checks of finished work.",
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

const prNumbers = (lines: string[]) => lines.flatMap((l) => [...l.matchAll(/(?<![\w/])#(\d+)/g)].map((m) => Number(m[1])));

export function openPrNumbers(facts: string[]): number[] | undefined {
  const line = facts.find((f) => f.startsWith("open PRs in this repository"));
  return line ? prNumbers([line.slice(line.indexOf(":") + 1)]) : undefined;
}

export function checkCard(raw: unknown, openPrs?: number[]): Card {
  const c = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null) throw new Error("write_card: the arguments are not an object.");
  if (!isLine(c.goal, LIMITS.goal)) problems.push(`goal: 1 to ${LIMITS.goal} characters`);
  if (c.status !== "active" && c.status !== "done") problems.push('status: "active" or "done"');
  if (typeof c.waitsForUser !== "boolean") problems.push("waitsForUser: true or false");
  if (!isState(c.state)) problems.push(`state: at most ${LIMITS.state} objects with now and target of 1 to ${LIMITS.line} characters`);
  for (const key of LISTS) {
    if (!isList(c[key], LIMITS[key])) problems.push(`${key}: at most ${LIMITS[key]} lines of 1 to ${LIMITS.line} characters`);
  }
  if (Array.isArray(c.next) && c.next.length === 0) problems.push("next: at least 1 action");
  if (c.status === "done" && Array.isArray(c.open) && c.open.length) problems.push("status done with open work: empty open or set status active");
  if (openPrs && isList(c.open, LIMITS.open) && isList(c.merged, LIMITS.merged)) {
    const notOpen = prNumbers(c.open as string[]).filter((n) => !openPrs.includes(n));
    const stillOpen = prNumbers(c.merged as string[]).filter((n) => openPrs.includes(n));
    if (notOpen.length) problems.push(`open: ${notOpen.map((n) => `#${n}`).join(", ")} is not open on GitHub (see the facts)`);
    if (stillOpen.length) problems.push(`merged: ${stillOpen.map((n) => `#${n}`).join(", ")} is still open on GitHub (see the facts)`);
  }
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
    `Resume: ${card.waitsForUser ? "wait for the answer of the user" : "go on at once with Next 1, without a question to the user"}`,
    ...section("In progress", card.inProgress),
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
