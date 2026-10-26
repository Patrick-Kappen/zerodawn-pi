import assert from "node:assert/strict";
import { test } from "node:test";
import { importers, isCode, isTestFile, parseStatus, selectTests } from "./select.ts";

const tree: Record<string, string> = {
  "src/a.ts": "export const a = 1;",
  "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a;',
  "src/c.ts": "export const c = 3;",
  "src/d.ts": 'export { a } from "./a.js";',
  "src/b.test.ts": 'import { b } from "./b.ts";',
  "test/e2e.test.ts": 'const m = await import("../src/b");',
  "src/c.spec.ts": "test('x', () => {});",
  "README.md": 'import x from "./src/a.ts"',
};
const read = (p: string) => tree[p];
const files = Object.keys(tree);

test("parseStatus: paths, and both paths of a rename", () => {
  assert.deepEqual(parseStatus(" M src/a.ts\0R  src/new.ts\0src/old.ts\0?? x.test.ts\0 D gone.ts\0"), [
    "src/a.ts",
    "src/new.ts",
    "src/old.ts",
    "x.test.ts",
    "gone.ts",
  ]);
});

test("isCode and isTestFile", () => {
  for (const p of ["a.ts", "a.mjs", "b/c.tsx"]) assert.ok(isCode(p), p);
  for (const p of ["a.d.ts", "a.md", "flake.nix"]) assert.ok(!isCode(p), p);
  for (const p of ["a.test.ts", "a.spec.js"]) assert.ok(isTestFile(p), p);
  assert.ok(!isTestFile("test.ts"));
});

test("importers: relative imports, a .js import of a .ts file, dynamic import; not from non-code files", () => {
  const g = importers(files, read);
  assert.deepEqual([...(g.get("src/a.ts") ?? [])].sort(), ["src/b.ts", "src/d.ts"]);
  assert.deepEqual([...(g.get("src/b.ts") ?? [])].sort(), ["src/b.test.ts", "test/e2e.test.ts"]);
});

test("selectTests: tests that reach a changed file through imports", () => {
  assert.deepEqual(selectTests(["src/b.ts"], files, read), { tests: ["src/b.test.ts", "test/e2e.test.ts"], uncovered: [] });
});

test("selectTests: a file that only a test imports through other files is uncovered, but its tests run", () => {
  assert.deepEqual(selectTests(["src/a.ts"], files, read), { tests: ["src/b.test.ts", "test/e2e.test.ts"], uncovered: ["src/a.ts"] });
});

test("selectTests: a test file of the same name covers a file; changed tests run; non-code files are ignored", () => {
  assert.deepEqual(selectTests(["src/c.ts", "src/b.test.ts", "README.md"], files, read), { tests: ["src/b.test.ts", "src/c.spec.ts"], uncovered: [] });
});

test("selectTests: a deleted test does not run; the tests of a deleted file do, and it needs no test", () => {
  const gone = { ...tree, "src/b.ts": 'import "./old.ts";' };
  const r = (p: string) => gone[p as keyof typeof gone];
  assert.deepEqual(selectTests(["src/x.test.ts", "src/old.ts"], files, r), { tests: ["src/b.test.ts", "test/e2e.test.ts"], uncovered: [] });
});
