import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "./card.ts";

export type Handoff = { card: Card; model: string; facts: string[]; recent: string[]; text: string; untilEntry: string; createdAt: string };

const files = (dir: string) =>
  readdirSync(dir)
    .filter((n) => /^\d+\.json$/.test(n))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

export function lastHandoff(sessionDir: string): Handoff | undefined {
  const dir = join(sessionDir, "handoff");
  let names: string[];
  try {
    names = files(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const last = names.at(-1);
  if (!last) return undefined;
  const path = join(dir, last);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Handoff;
  } catch (err) {
    throw new Error(`handoff: cannot read ${path}: ${(err as Error).message}. Remove or fix the file.`, { cause: err });
  }
}

export function saveHandoff(sessionDir: string, handoff: Handoff): string {
  const dir = join(sessionDir, "handoff");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${files(dir).length + 1}.json`);
  writeFileSync(path, `${JSON.stringify(handoff, null, 2)}\n`);
  return path;
}
