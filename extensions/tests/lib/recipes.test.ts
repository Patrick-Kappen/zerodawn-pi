import assert from "node:assert/strict";
import { test } from "node:test";
import { isCheck, isTest, normalize, parseJust, parseMake, promptText, Tracker } from "./recipes.ts";

const dump = JSON.stringify({
  recipes: {
    test: { name: "test", doc: "Unit tests", private: false, parameters: [], body: [["node --experimental-strip-types --test a.test.ts"]] },
    build: { name: "build", doc: null, private: false, parameters: [{ name: "t" }], body: [["echo ", [["variable", "t"]]]] },
    _helper: { name: "_helper", doc: null, private: false, parameters: [], body: [["true"]] },
  },
});
const just = parseJust(dump, "/p/justfile");
const long = "python3 bench/sessions.py --days 7 --exclude 01a153bc --model opus --format table --out /tmp/x";

test("parseJust: plain bodies, no body with parameters, no private recipes", () => {
  assert.deepEqual(just.list, [
    { name: "test", doc: "Unit tests", body: "node --experimental-strip-types --test a.test.ts" },
    { name: "build", doc: undefined, body: undefined },
  ]);
  assert.match(promptText(just), /- just test: Unit tests\n- just build$/);
});

test("parseMake: targets with tab bodies", () => {
  const m = parseMake("# Run tests\ntest:\n\t@pytest -q\n.PHONY: test\nX := 1\nbuild: dep\n\tcc $(SRC)\n", "/p/Makefile");
  assert.deepEqual(m.list, [
    { name: "test", doc: "Run tests", body: "pytest -q" },
    { name: "build", doc: undefined, body: undefined },
  ]);
});

const recipe = parseJust(
  JSON.stringify({ recipes: { lint: { name: "lint", doc: null, private: false, parameters: [], body: [["biome check ."]] } } }),
  "/p/justfile",
);

test("normalize", () => {
  assert.equal(normalize("cd /p &&  node --test   a.ts 2>&1"), "node --test a.ts");
});

test("isTest: test commands of many tools, also behind cd, env, npx, uv run, nix develop, bash -c", () => {
  const tests = [
    "just test",
    "just test-changed a.ts",
    "npm test",
    "bun run test:unit",
    "bun test x | tail",
    "node --experimental-strip-types --test x.ts",
    "bun extensions/x/a.test.ts",
    "node --experimental-strip-types a.test.ts",
    "cd x && pytest -q",
    "CI=1 uv run pytest",
    "python -m unittest",
    "npx vitest run",
    "deno test",
    "go test ./...",
    "cargo nextest run",
    "dotnet test",
    "nix develop -c pytest",
    "pwsh -c 'Invoke-Pester ./tests'",
    'bash -c "cd x && bun test"',
    "ls; make test",
  ];
  for (const c of tests) assert.ok(isTest(c), c);
  const others = [
    "just build",
    "just check",
    "nix flake check",
    "node x.ts",
    "grep test file",
    "ls pytest",
    "nix build",
    'git commit -m "run pytest"',
    "cat <<EOF\ngo test\nEOF",
  ];
  for (const c of others) assert.ok(!isTest(c), c);
});

test("isCheck: lint, type and check commands; not tests or builds", () => {
  for (const c of ["just check", "just lint", "nix flake check", "biome check .", "npx eslint src", "tsc", "cargo clippy", "ruff check .", "go vet ./..."])
    assert.ok(isCheck(c), c);
  for (const c of ["just test", "nix build", "just fmt", "echo tsc", 'git commit -m "just check"']) assert.ok(!isCheck(c), c);
});

test("a command that a recipe does is blocked", () => {
  assert.match(new Tracker().check("biome check .", recipe)!, /Run "just lint"/);
});

test("a long command that ran 3 times gets a hint, no block", () => {
  const t = new Tracker();
  assert.equal(t.started(long, just), undefined);
  assert.equal(t.started(long, just), undefined);
  assert.equal(t.check(long, just), undefined);
  assert.match(t.started(long, just)!, /ran 3 times\. Add it as a recipe to \/p\/justfile/);
  assert.equal(t.started(long, just), undefined);
  assert.equal(t.check("ls -la", just), undefined);
});

test("without a justfile: a hint, no block", () => {
  const t = new Tracker();
  t.started(long, undefined);
  t.started(long, undefined);
  assert.equal(t.check(long, undefined), undefined);
  assert.match(t.started(long, undefined)!, /no justfile: tell the user/);
});
