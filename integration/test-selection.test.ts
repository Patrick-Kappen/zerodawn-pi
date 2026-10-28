import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(sourceRoot, "scripts/test-changed.sh");
const unitFlags = ["--path-ignore-patterns", "**/*.integration.test.ts"];
const allUnitFlags = [...unitFlags, "--path-ignore-patterns", "**/integration/**"];
const integration = ["bun", "test", ".integration.test.ts", "integration/"];
const cases = [
  { files: ["extensions/checker/index.ts"], expected: ["bun", "test", "./extensions/checker", ...allUnitFlags] },
  {
    files: ["extensions/checker/index.ts", "extensions/checker/index.test.ts"],
    expected: ["bun", "test", "./extensions/checker", ...allUnitFlags],
  },
  {
    files: ["extensions/checker/index.ts", "integration/background-checker.test.ts"],
    expected: ["bun", "test", "./extensions/checker", ...allUnitFlags, ...integration],
  },
  { files: ["integration/release.test.ts"], expected: integration },
  { files: ["extensions/bash/tool/bash.integration.test.ts"], expected: integration },
  { files: ["shared/config.integration.test.ts"], expected: integration },
  { files: ["shared/config.ts"], expected: ["bun", "test", ...allUnitFlags] },
  { files: ["package.json"], expected: ["bun", "test", ...allUnitFlags] },
  { files: ["scripts/bump-changed.sh"], expected: ["nix", "flake", "check", "--option", "warn-dirty", "false"] },
];

test("changed files select unit tests unless integration tests or repository checks change", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-test-selection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const shell = execFileSync("bash", ["-c", 'printf "%s" "$BASH"'], { encoding: "utf8", timeout: 5000 });
  for (const command of ["bun", "nix"]) {
    const file = join(bin, command);
    writeFileSync(file, `#!${shell}\nprintf '%s\\n' '${command}' "$@"\n`);
    chmodSync(file, 0o755);
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  for (const { files, expected } of cases) {
    const output = execFileSync("bash", [script, ...files], { cwd: root, env, encoding: "utf8", timeout: 5000 });
    assert.deepEqual(output.trim().split("\n"), expected, files.join(", "));
  }
  const docs = execFileSync("bash", [script, "docs/guide.md"], { cwd: root, env, encoding: "utf8", timeout: 5000 });
  assert.equal(docs, "test-changed: only documentation changed: docs/guide.md\n");
  const missing = spawnSync("bash", [script], { cwd: root, env, encoding: "utf8", timeout: 5000 });
  if (missing.error) throw missing.error;
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no files given.*just test-changed FILE/);

  writeFileSync(join(bin, "bun"), `#!${shell}\nprintf 'unit failure\\n' >&2\nexit 7\n`);
  const failed = spawnSync("bash", [script, "extensions/checker/index.ts", "integration/release.test.ts"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 5000,
  });
  if (failed.error) throw failed.error;
  assert.equal(failed.status, 7);
  assert.equal(failed.stderr, "unit failure\n", "stop after unit failure; do not start integration tests");
});

test("real Bun discovery partitions every fixture once and keeps affected units isolated", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-test-groups-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixtures = {
    "extensions/alpha/index.test.ts": "UNIT_ALPHA",
    "extensions/alpha/integration-helper.test.ts": "UNIT_ALPHA_HELPER",
    "extensions/alpha/integration/contract.test.ts": "INTEGRATION_DIRECTORY",
    "extensions/beta/lib/nested.test.ts": "UNIT_BETA",
    "shared/config.test.ts": "UNIT_SHARED",
    "extensions/alpha/lib/job.integration.test.ts": "INTEGRATION_ALPHA",
    "shared/config.integration.test.ts": "INTEGRATION_SHARED",
    "integration/release.test.ts": "INTEGRATION_ROOT",
    "integration/nested/contract.test.ts": "INTEGRATION_NESTED",
  };
  for (const [path, name] of Object.entries(fixtures)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `import { test } from "bun:test"; test("${name}", () => {});\n`);
  }
  const run = (args: string[]) => {
    const result = spawnSync("bash", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    // FORCE_COLOR of the caller gives colour codes, and bun prints a check mark or (pass) after the environment.
    const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
    return [...output.matchAll(/(?:\(pass\)|\u2713) (\w+)/g)].map((match) => match[1]).sort();
  };
  const justfile = readFileSync(join(sourceRoot, "justfile"), "utf8");
  const recipe = (name: string) => {
    const command = justfile.match(new RegExp(`^${name}: pi-version\\n    (.+)$`, "m"))?.[1];
    assert.ok(command, `justfile: ${name} must run its Bun test group`);
    return command;
  };
  const units = run(["-c", recipe("test-unit")]);
  const integrations = run(["-c", recipe("test-integration")]);
  assert.deepEqual(units, ["UNIT_ALPHA", "UNIT_ALPHA_HELPER", "UNIT_BETA", "UNIT_SHARED"]);
  assert.deepEqual(integrations, ["INTEGRATION_ALPHA", "INTEGRATION_DIRECTORY", "INTEGRATION_NESTED", "INTEGRATION_ROOT", "INTEGRATION_SHARED"]);
  assert.deepEqual([...units, ...integrations].sort(), Object.values(fixtures).sort());
  assert.match(justfile, /^test: test-unit test-integration$/m);
  assert.deepEqual(run([script, "extensions/alpha/index.ts"]), ["UNIT_ALPHA", "UNIT_ALPHA_HELPER"]);
  assert.deepEqual(run([script, "shared/config.ts"]), units);
  assert.deepEqual(run([script, "extensions/alpha/lib/job.integration.test.ts"]), integrations);
  assert.deepEqual(run([script, "extensions/alpha/index.ts", "integration/release.test.ts"]), ["UNIT_ALPHA", "UNIT_ALPHA_HELPER", ...integrations].sort());

  writeFileSync(
    join(root, "extensions/alpha/index.test.ts"),
    'import { test } from "bun:test"; test("UNIT_ALPHA", () => { throw new Error("unit failure"); });\n',
  );
  const failed = spawnSync("bash", [script, "extensions/alpha/index.ts"], { cwd: root, encoding: "utf8", timeout: 10_000 });
  if (failed.error) throw failed.error;
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /unit failure/);
});

test("the commit hook runs the tests of the staged files; the push hook runs every test", (t) => {
  const hooks = JSON.parse(readFileSync(join(sourceRoot, ".pre-commit-config.yaml"), "utf8").replace(/^#.*\n/gm, ""));
  type Hook = { id: string; entry: string; always_run: boolean; pass_filenames: boolean; stages: string[] };
  const entries: Hook[] = hooks.repos.flatMap((repo: { hooks: Hook[] }) => repo.hooks);
  assert.ok(entries.some((hook) => hook.id === "biome"));
  assert.ok(entries.some((hook) => hook.id === "gitleaks"));
  const changed = entries.find((hook) => hook.id === "tests-changed");
  assert.ok(changed, "the commit hook must run the tests of the staged files");
  assert.equal(changed.pass_filenames, true);
  assert.deepEqual(changed.stages, ["pre-commit"]);
  assert.match(readFileSync(changed.entry, "utf8"), /exec scripts\/test-changed\.sh "\$@"/);
  const all = entries.find((hook) => hook.id === "tests-all");
  assert.ok(all, "the push hook must run every test");
  assert.equal(all.always_run, true);
  assert.deepEqual(all.stages, ["pre-push"]);

  const root = mkdtempSync(join(tmpdir(), "pi-push-hook-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "integration"));
  writeFileSync(
    join(root, "unit.test.ts"),
    'import { test } from "bun:test"; test("UNIT_HOOK", () => { if (process.env.GIT_INDEX_FILE) throw new Error("GIT_INDEX_FILE leaked"); });\n',
  );
  writeFileSync(join(root, "integration", "contract.test.ts"), 'import { test } from "bun:test"; test("INTEGRATION_HOOK", () => {});\n');
  const run = () => {
    const env = { ...process.env, GIT_INDEX_FILE: join(root, "index") };
    const result = spawnSync(all.entry, [], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
    if (result.error) throw result.error;
    return result;
  };
  const passed = run();
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stderr, /UNIT_HOOK/);
  assert.match(passed.stderr, /INTEGRATION_HOOK/);
  writeFileSync(join(root, "unit.test.ts"), 'import { test } from "bun:test"; test("UNIT_HOOK", () => { throw new Error("unit hook failure"); });\n');
  const failed = run();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /unit hook failure/);
  const flake = readFileSync(join(sourceRoot, "flake.nix"), "utf8");
  assert.match(flake, /nativeBuildInputs = \[ pkgs\.bun \];/);
  assert.match(flake, /HOME="\$TMPDIR" bun test .*\n\s+--path-ignore-patterns '\*\*\/\*\.integration\.test\.ts'/);
  assert.match(flake, /HOME="\$TMPDIR" bun test \.integration\.test\.ts integration\//);
});
