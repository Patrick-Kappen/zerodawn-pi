import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripQuoted } from "../../../shared/util.ts";

export type Recipe = { name: string; doc?: string; body?: string };
export type Recipes = { tool: "just" | "make"; file: string; list: Recipe[] };

const REPEAT_MAX = 2;
const LONG = 80;
const TEST_TOOLS = [
  "(just|make)\\s+test\\S*",
  "(npm|pnpm|yarn|bun)\\s+(run\\s+)?test\\S*",
  "node\\s+(--\\S+\\s+)*--test",
  "(bun|node|deno|tsx|ts-node)\\s+(--?\\S+\\s+)*\\S+\\.(test|spec)\\.[cm]?[jt]sx?",
  "deno\\s+test",
  "pytest",
  "python3?\\s+-m\\s+(pytest|unittest)",
  "(tox|nox)",
  "cargo\\s+(test|nextest)",
  "go\\s+test",
  "(vitest|jest|mocha|ava)",
  "dotnet\\s+test",
  "Invoke-Pester",
  "mvn\\s+(\\S+\\s+)*test",
  "(gradle|\\./gradlew)\\s+(\\S+\\s+)*test",
  "(ctest|rspec|phpunit)",
  "mix\\s+test",
  "zig\\s+build\\s+test",
];
const CHECK_TOOLS = [
  "(just|make)\\s+(check|lint|types|typecheck|verify|ci)\\S*",
  "(npm|pnpm|yarn|bun)\\s+(run\\s+)?(check|lint|types|typecheck)\\S*",
  "nix\\s+flake\\s+check",
  "biome\\s+(check|lint|ci)",
  "(eslint|tsc|mypy|pyright|shellcheck|golangci-lint|statix|deadnix|Invoke-ScriptAnalyzer)",
  "ruff\\s+check",
  "cargo\\s+(clippy|check)",
  "go\\s+vet",
];
const WRAPPERS = "((\\w+=\\S*|npx|bunx|pnpm\\s+exec|uv\\s+run|poetry\\s+run|pipenv\\s+run|nix\\s+develop\\s+(\\S+\\s+)*-c|timeout\\s+\\S+|time)\\s+)*";
const atCommand = (tools: string[]) => new RegExp(`(^|[;&|(]|\\bthen|\\bdo)\\s*${WRAPPERS}(${tools.join("|")})(?=$|[\\s;&|)])`);
const TEST = atCommand(TEST_TOOLS);
const CHECK = atCommand(CHECK_TOOLS);
const SHELL_C = /\b(bash|sh|zsh|pwsh|powershell)\s+(-\S+\s+)*-c(ommand)?\s+(["'])([\s\S]*?)\4/g;

/** The command, and the commands in the strings of "bash -c", without the other quoted text and heredocs. */
function commandsOf(command: string): string[] {
  return [stripQuoted(command), ...[...command.matchAll(SHELL_C)].flatMap((m) => commandsOf(m[5]))];
}

export const isTest = (command: string) => commandsOf(command).some((c) => TEST.test(c));
export const isCheck = (command: string) => commandsOf(command).some((c) => CHECK.test(c));

export function normalize(command: string): string {
  return command
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^cd \S+ && /, "")
    .replace(/ 2>&1$/, "");
}

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

export function promptText(r: Recipes): string {
  const run = r.tool === "just" ? "just" : "make";
  const lines = r.list.map((x) => `- ${run} ${x.name}${x.doc ? `: ${x.doc}` : ""}`);
  return `Project recipes (${r.file}). Run project tasks with them. Run tests with run_tests. A test or check command in bash runs in place, with a short result. A bash command that a recipe does is blocked. A hint tells you when a long command runs ${REPEAT_MAX + 1} times. Then add it as a recipe.\n${lines.join("\n")}`;
}

export class Tracker {
  private runs = new Map<string, number>();

  check(command: string, recipes: Recipes | undefined): string | undefined {
    const norm = normalize(command);
    const same = recipes?.list.find((r) => r.body && normalize(r.body) === norm);
    if (same && recipes) return `This command is the recipe "${same.name}" in ${recipes.file}. Run "${recipes.tool} ${same.name}".`;
    return undefined;
  }

  started(command: string, recipes: Recipes | undefined): string | undefined {
    const norm = normalize(command);
    const count = (this.runs.get(norm) ?? 0) + 1;
    this.runs.set(norm, count);
    if (norm.length < LONG || count !== REPEAT_MAX + 1) return undefined;
    if (!recipes) return `This command ran ${count} times. This project has no justfile: tell the user that a recipe for it can help.`;
    if (!norm.startsWith(`${recipes.tool} `)) return `This command ran ${count} times. Add it as a recipe to ${recipes.file}, then run the recipe.`;
    return undefined;
  }
}
