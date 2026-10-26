import { dirname, join, normalize } from "node:path";

const CODE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

export const isCode = (path: string) => CODE.test(path) && !path.endsWith(".d.ts");
export const isTestFile = (path: string) => TEST_FILE.test(path);

/** Paths from `git status --porcelain=v1 -z`; a rename gives both the new and the old path. */
export function parseStatus(z: string): string[] {
  const parts = z.split("\0").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    out.push(parts[i].slice(3));
    if (code.includes("R") || code.includes("C")) out.push(parts[++i]);
  }
  return out;
}

function resolveImport(from: string, spec: string, files: Set<string>): string | undefined {
  const base = normalize(join(dirname(from), spec));
  const stems = base.endsWith(".js") ? [base, base.slice(0, -3)] : [base];
  for (const stem of stems) for (const s of SUFFIXES) if (files.has(stem + s)) return stem + s;
  return undefined;
}

/** Reads a file relative to the project; undefined when it does not exist. */
export type Read = (path: string) => string | undefined;

/** For each file, the files that import it directly. */
export function importers(files: string[], read: Read): Map<string, Set<string>> {
  const set = new Set(files);
  const map = new Map<string, Set<string>>();
  for (const file of files) {
    const text = isCode(file) ? read(file) : undefined;
    if (text === undefined) continue;
    for (const m of text.matchAll(IMPORT)) {
      const target = resolveImport(file, m[1], set);
      if (!target) continue;
      if (!map.has(target)) map.set(target, new Set());
      map.get(target)?.add(file);
    }
  }
  return map;
}

export type Selection = { tests: string[]; uncovered: string[] };

/**
 * Tests to run: changed test files, and test files that import a changed file directly or through other files.
 * A changed code file that exists, that no test file imports directly, and that has no test file of the same name, is uncovered.
 */
export function selectTests(changed: string[], files: string[], read: Read): Selection {
  const graph = importers([...new Set([...files, ...changed])], read);
  const tests = new Set<string>();
  const uncovered: string[] = [];
  for (const file of changed.filter(isCode)) {
    if (isTestFile(file)) {
      if (read(file) !== undefined) tests.add(file);
      continue;
    }
    const direct = [...(graph.get(file) ?? [])].filter(isTestFile);
    const sibling = files.find((f) => isTestFile(f) && f.replace(TEST_FILE, "") === file.replace(CODE, ""));
    if (!direct.length && !sibling && read(file) !== undefined) uncovered.push(file);
    if (sibling) tests.add(sibling);
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length) {
      for (const next of graph.get(queue.shift() as string) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        if (isTestFile(next)) tests.add(next);
        queue.push(next);
      }
    }
  }
  return { tests: [...tests].sort(), uncovered: uncovered.sort() };
}
