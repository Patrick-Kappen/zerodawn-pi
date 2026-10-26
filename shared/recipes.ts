import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Recipe = { name: string; doc?: string; body?: string };
export type Recipes = { tool: "just" | "make"; file: string; list: Recipe[] };

const lineOf = (part: unknown): string => (typeof part === "string" ? part : "\u0000");

export function parseJust(dump: string, file: string): Recipes {
  const recipes = JSON.parse(dump).recipes as Record<string, any>;
  const list = Object.values(recipes)
    .filter((r) => !r.private && !r.name.startsWith("_"))
    .map((r): Recipe => {
      const lines = (r.body as unknown[][]).map((l) => l.map(lineOf).join(""));
      const plain = !r.parameters.length && lines.every((l) => !l.includes("\u0000"));
      return { name: r.name, doc: r.doc ?? undefined, body: plain && lines.length ? lines.map((l) => l.replace(/^[@-]+/, "")).join(" && ") : undefined };
    });
  return { tool: "just", file, list };
}

export function parseMake(text: string, file: string): Recipes {
  const list: Recipe[] = [];
  let doc: string | undefined;
  let current: { name: string; doc?: string; lines: string[] } | undefined;
  const close = () => {
    if (!current) return;
    const plain = current.lines.length && current.lines.every((l) => !l.includes("$"));
    list.push({ name: current.name, doc: current.doc, body: plain ? current.lines.join(" && ") : undefined });
    current = undefined;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("\t") && current) current.lines.push(line.trim().replace(/^[@-]+/, ""));
    else if (line.startsWith("#")) doc = line.replace(/^#+\s*/, "");
    else {
      close();
      const m = line.match(/^([A-Za-z0-9][\w.-]*)\s*:(?!=)/);
      if (m && !m[1].startsWith(".")) current = { name: m[1], doc, lines: [] };
      doc = undefined;
    }
  }
  close();
  return { tool: "make", file, list };
}

const cache = new Map<string, { mtime: number; recipes: Recipes }>();

export function loadRecipes(cwd: string): Recipes | undefined {
  const just = ["justfile", "Justfile", ".justfile"].map((n) => join(cwd, n)).find(existsSync);
  const make = ["Makefile", "makefile", "GNUmakefile"].map((n) => join(cwd, n)).find(existsSync);
  const file = just ?? make;
  if (!file) return undefined;
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit?.mtime === mtime) return hit.recipes;
  let recipes: Recipes;
  try {
    recipes = just
      ? parseJust(execFileSync("just", ["--justfile", just, "--dump", "--dump-format", "json"], { cwd, encoding: "utf8" }), just)
      : parseMake(readFileSync(file, "utf8"), file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" && just)
      throw new Error(`recipes: ${just} exists but "just" is not installed. Install just, or remove the justfile.`, { cause: err });
    throw new Error(`recipes: cannot read the recipes of ${file}: ${(err as Error).message}. Fix the file, or run "just --list" to see the error.`, {
      cause: err,
    });
  }
  cache.set(file, { mtime, recipes });
  return recipes;
}
