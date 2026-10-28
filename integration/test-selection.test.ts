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
    return [...`${result.stdout}\n${result.stderr}`.matchAll(/\(pass\) (\w+)/g)].map((match) => match[1]).sort();
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

test("commit hooks omit test suites while Nix keeps both groups", () => {
  const hooks = JSON.parse(readFileSync(join(sourceRoot, ".pre-commit-config.yaml"), "utf8").replace(/^#.*\n/gm, ""));
  const entries = hooks.repos.flatMap((repo: { hooks: { id: string; entry: string }[] }) => repo.hooks);
  assert.ok(entries.some((hook: { id: string }) => hook.id === "biome"));
  assert.ok(entries.some((hook: { id: string }) => hook.id === "gitleaks"));
  assert.ok(entries.every((hook: { id: string; entry: string }) => !/^tests?\b/.test(hook.id) && !/\bbun test\b/.test(hook.entry)));
  const flake = readFileSync(join(sourceRoot, "flake.nix"), "utf8");
  assert.match(flake, /nativeBuildInputs = \[ pkgs\.bun \];/);
  assert.match(flake, /HOME="\$TMPDIR" bun test .*\n\s+--path-ignore-patterns '\*\*\/\*\.integration\.test\.ts'/);
  assert.match(flake, /HOME="\$TMPDIR" bun test \.integration\.test\.ts integration\//);
});
