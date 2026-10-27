import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { PairEntry } from "../../../shared/pair.ts";

export type Scope = "projects" | "worktrees";
export type Item = { path: string; label: string; open: boolean; agent: boolean; window?: string };
export type State = { scope: Scope; items: Record<Scope, Item[]>; query: string; cursor: number };
export type Input = { kind: "up" | "down" | "tab" | "enter" | "escape" | "backspace" | "ctrl-n" | "ctrl-d" } | { kind: "text"; text: string };
export type Outcome = { kind: "select"; path: string } | { kind: "new" } | { kind: "remove"; item: Item } | { kind: "cancel" };

export const initial = (items: Record<Scope, Item[]>): State => ({ scope: "projects", items, query: "", cursor: 0 });

export function labelOf(path: string): string {
  return `${basename(dirname(path))}/${basename(path)}`;
}

// A typed path is accepted as it is: absolute, home-relative or relative with a dot.
export function typedPath(query: string, home: string = homedir()): string | undefined {
  const q = query.trim();
  if (q === "~") return home;
  if (q.startsWith("~/")) return join(home, q.slice(2));
  if (q.startsWith("/") || q.startsWith("./") || q.startsWith("../")) return q;
  return undefined;
}

export function visible(state: State): Item[] {
  const q = state.query.trim().toLowerCase();
  const list = state.items[state.scope];
  if (q === "" || typedPath(q)) return list;
  return list.filter((item) => `${item.label} ${item.path}`.toLowerCase().includes(q));
}

export function openItems(entries: PairEntry[]): Item[] {
  return entries.map((e) => ({ path: e.worktree, label: labelOf(e.worktree), open: true, agent: e.agent, window: e.window }));
}

export function recentItems(paths: string[], open: PairEntry[]): Item[] {
  return paths.map((path) => {
    const entry = open.find((e) => e.worktree === path);
    return { path, label: labelOf(path), open: entry !== undefined, agent: entry?.agent ?? false, window: entry?.window };
  });
}

export function worktreeItems(paths: string[], open: PairEntry[]): Item[] {
  return recentItems(paths, open);
}

export function parseWorktrees(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

const clamp = (state: State, cursor: number): number => Math.max(0, Math.min(cursor, visible(state).length - 1));

export function step(state: State, input: Input): { state: State; outcome?: Outcome } {
  switch (input.kind) {
    case "up":
      return { state: { ...state, cursor: clamp(state, state.cursor - 1) } };
    case "down":
      return { state: { ...state, cursor: clamp(state, state.cursor + 1) } };
    case "tab":
      return { state: { ...state, scope: state.scope === "projects" ? "worktrees" : "projects", cursor: 0 } };
    case "escape":
      return { state, outcome: { kind: "cancel" } };
    case "backspace": {
      const next = { ...state, query: state.query.slice(0, -1) };
      return { state: { ...next, cursor: 0 } };
    }
    case "text": {
      const next = { ...state, query: state.query + input.text };
      return { state: { ...next, cursor: 0 } };
    }
    case "ctrl-n":
      return { state, outcome: { kind: "new" } };
    case "ctrl-d": {
      const item = visible(state)[state.cursor];
      return item && state.scope === "worktrees" ? { state, outcome: { kind: "remove", item } } : { state };
    }
    case "enter": {
      const typed = typedPath(state.query);
      if (typed) return { state, outcome: { kind: "select", path: typed } };
      const item = visible(state)[state.cursor];
      return item ? { state, outcome: { kind: "select", path: item.path } } : { state };
    }
  }
}

export function mark(item: Item): string {
  return `${item.open ? "●" : "○"}${item.agent ? "π" : " "}`;
}

export function render(state: State, rows = 8): string[] {
  const list = visible(state);
  const start = Math.max(0, Math.min(state.cursor - Math.floor(rows / 2), list.length - rows));
  const scopes = (["projects", "worktrees"] as const).map((s) => (s === state.scope ? `[${s}]` : ` ${s} `)).join(" ");
  const lines = [`${scopes}  › ${state.query}`];
  for (const [i, item] of list.slice(start, start + rows).entries()) {
    lines.push(`${start + i === state.cursor ? "›" : " "} ${mark(item)} ${item.label}  ${item.path}`);
  }
  if (list.length === 0) lines.push(typedPath(state.query) ? `  enter: switch to ${state.query}` : "  nothing matches");
  lines.push("tab scope · enter switch · ^n new worktree · ^d remove · esc close");
  return lines;
}
