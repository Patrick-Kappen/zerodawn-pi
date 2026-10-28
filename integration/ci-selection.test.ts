import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../scripts/", import.meta.url));
const all = ["pre-commit", "hooks-config", "types", "tests-alpha", "tests-beta", "tests-shared", "tests-integration"].sort();
const extension = ["pre-commit", "types", "tests-alpha", "tests-integration"].sort();

test("Nix skips both test hook names so the unit split cannot repeat tests in CI", () => {
  const flake = readFileSync(fileURLToPath(new URL("../flake.nix", import.meta.url)), "utf8");
  const skip = flake.match(/preCommit\.overrideAttrs\s*\{\s*SKIP = "([^"]+)";/);
  assert.ok(skip, "the Nix pre-commit check must skip the local test hooks");
  assert.deepEqual(skip[1].split(","), ["tests-changed", "tests-all"]);
});

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "pi-ci-selection-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const log = join(root, "nix.log");
  mkdirSync(repo);
  mkdirSync(bin);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: `${bin}:${process.env.PATH}`,
    CI_NIX_LOG: log,
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", timeout: 5000 }).trim();
  const write = (file: string, content: string) => {
    const path = join(repo, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  git("init", "-q", "--template=", "-b", "main");
  git("config", "user.name", "CI Test");
  git("config", "user.email", "ci-test@example.com");
  git("config", "core.hooksPath", "/dev/null");
  git("config", "commit.gpgsign", "false");
  const shell = execFileSync("bash", ["-c", 'printf "%s" "$BASH"'], { encoding: "utf8", timeout: 5000 });
  for (const name of ["ci-checks.sh", "check-branch-msgs.sh", "check-commit-msg.sh"]) {
    write(`scripts/${name}`, readFileSync(join(source, name), "utf8").replace(/^#!.*$/m, `#!${shell}`));
    chmodSync(join(repo, "scripts", name), 0o755);
  }
  const nix = join(bin, "nix");
  writeFileSync(
    nix,
    `#!${shell}
set -eu
printf '%s\\n' "$*" >> "$CI_NIX_LOG"
if [ "$1" = "\${CI_NIX_FAIL-}" ]; then echo "fixture nix $1 failed" >&2; exit 7; fi
case "$1" in
  eval) printf '%s\\n' '${JSON.stringify(all)}' ;;
  build | develop) ;;
  *) echo "unexpected nix command: $*" >&2; exit 8 ;;
esac
`,
    { mode: 0o755 },
  );
  write("package.json", '{"name":"fixture","version":"0.1.0"}\n');
  write("extensions/alpha/index.ts", "export const value = 1;\n");
  write("extensions/alpha/package.json", '{"name":"alpha","version":"0.1.0"}\n');
  write("extensions/beta/index.ts", "export const value = 2;\n");
  write("shared/config.ts", "export const config = {};\n");
  write("shared/package.json", '{"name":"shared","version":"0.1.0"}\n');
  const commit = (message = "ci: fixture change\n\nChange: fix") => {
    git("add", ".");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  const base = commit();
  const run = (mode: string, before = base, fail?: string) => {
    writeFileSync(log, "");
    const result = spawnSync("bash", ["scripts/ci-checks.sh", mode, before], {
      cwd: repo,
      env: { ...env, CI_NIX_FAIL: fail ?? "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) throw result.error;
    const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    const builds = calls.filter((call) => call.startsWith("build "));
    const checks = builds.flatMap((call) =>
      call
        .split(" ")
        .filter((arg) => arg.startsWith(".#checks."))
        .map((arg) => arg.split(".").at(-1)),
    );
    return { ...result, calls, checks: checks.sort() };
  };
  return { repo, git, write, commit, base, run };
}

const cases = [
  { name: "security policy", files: { "SECURITY.md": "# Security\n" }, checks: ["pre-commit"] },
  { name: "nested manifest fixture", files: { "extensions/alpha/fixtures/package.json": '{"version":"0.1.0"}\n' }, checks: extension },
  {
    name: "new extension manifest",
    files: { "extensions/beta/package.json": '{"name":"beta","version":"0.1.0"}\n' },
    checks: ["pre-commit", "tests-beta", "tests-integration", "types"],
  },
  {
    name: "shared dependencies",
    files: { "shared/package.json": '{"name":"shared","version":"0.2.0","dependencies":{"new":"1"}}\n' },
    checks: all,
    compat: true,
  },
  { name: "root documentation", files: { "README.md": "# Guide\n" }, checks: ["pre-commit"] },
  { name: "task documentation", files: { "docs/tasks/a guide.md": "# Guide\n" }, checks: ["pre-commit"] },
  { name: "extension documentation", files: { "extensions/alpha/README.md": "# Guide\n" }, checks: ["pre-commit"] },
  { name: "shared documentation", files: { "shared/README.md": "# Guide\n" }, checks: ["pre-commit"] },
  { name: "extension source", files: { "extensions/alpha/index.ts": "export const value = 3;\n" }, checks: extension },
  { name: "mixed docs and code", files: { "docs/guide.md": "# Guide\n", "extensions/alpha/new.ts": "export {};\n" }, checks: extension },
  { name: "test fixtures", files: { "extensions/alpha/fixtures/README.md": "changed fixture\n" }, checks: extension },
  { name: "integration tests", files: { "integration/example.test.ts": "export {};\n" }, checks: ["pre-commit", "tests-integration", "types"] },
  { name: "shared source", files: { "shared/config.ts": "export const config = { changed: true };\n" }, checks: all, compat: true },
  { name: "build inputs", files: { "flake.lock": "{}\n" }, checks: all, compat: true },
  { name: "build definitions", files: { "flake.nix": "{}\n" }, checks: all, compat: true },
  { name: "scripts", files: { "scripts/other.sh": "exit 0\n" }, checks: all },
  { name: "unknown files", files: { "new-config": "changed\n" }, checks: all },
  { name: "root dependencies", files: { "package.json": '{"name":"fixture","version":"0.2.0","dependencies":{"new":"1"}}\n' }, checks: all, compat: true },
  {
    name: "extension dependencies",
    files: { "extensions/alpha/package.json": '{"name":"alpha","version":"0.2.0","dependencies":{"new":"1"}}\n' },
    checks: extension,
  },
  {
    name: "release metadata",
    files: { "package.json": '{"name":"fixture","version":"0.2.0"}\n', "README.md": "# Release\n" },
    checks: ["pre-commit"],
    release: true,
  },
];

for (const mode of ["pr", "main"]) {
  for (const scenario of cases) {
    test(`CI ${mode}: ${scenario.name}`, (t) => {
      const f = fixture(t);
      for (const [file, content] of Object.entries(scenario.files)) f.write(file, content);
      f.commit();
      const result = f.run(mode);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.checks, scenario.checks);
      assert.equal(
        result.calls.some((call) => call.includes("scripts/compat.sh")),
        "compat" in scenario && scenario.compat,
      );
      assert.equal(
        result.calls.some((call) => call.includes("scripts/release-check.sh")),
        "release" in scenario && scenario.release,
      );
    });
  }
}

test("CI selects each suite once for several files and extensions", (t) => {
  const f = fixture(t);
  f.write("extensions/alpha/one.ts", "export {};\n");
  f.write("extensions/alpha/two.ts", "export {};\n");
  f.write("extensions/beta/one.ts", "export {};\n");
  f.commit();
  const result = f.run("pr");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.checks, [...extension, "tests-beta"].sort());
});

test("CI includes deleted source when a file moves into documentation", (t) => {
  const f = fixture(t);
  f.git("mv", "extensions/alpha/index.ts", "README.md");
  f.commit();
  const result = f.run("pr");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.checks, extension);
});

test("CI selects all checks for a deleted extension", (t) => {
  const f = fixture(t);
  f.git("rm", "-r", "extensions/alpha");
  f.commit();
  assert.equal(existsSync(join(f.repo, "extensions/alpha")), false);
  const result = f.run("pr");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.checks, all);
});

test("CI main compares the whole push, not only its last commit", (t) => {
  const f = fixture(t);
  f.write("extensions/alpha/new.ts", "export {};\n");
  f.commit();
  f.write("README.md", "# Guide\n");
  f.commit();
  const result = f.run("main");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.checks, extension);
});

test("CI PR compares against the merge base, not later base-branch changes", (t) => {
  const f = fixture(t);
  f.git("switch", "-qc", "feature");
  f.write("README.md", "# Guide\n");
  f.commit();
  f.git("switch", "-q", "main");
  f.write("shared/config.ts", "export const changed = true;\n");
  const base = f.commit();
  f.git("switch", "-q", "feature");
  const result = f.run("pr", base);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.checks, ["pre-commit"]);
});

for (const operation of ["eval", "build", "develop"]) {
  test(`CI preserves a failed nix ${operation}`, (t) => {
    const f = fixture(t);
    f.write("shared/config.ts", "export const changed = true;\n");
    f.commit();
    const result = f.run("pr", f.base, operation);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`fixture nix ${operation} failed`));
    assert.match(result.stderr, /Next:/);
    if (operation === "eval") assert.deepEqual(result.checks, []);
    if (operation === "build")
      assert.equal(
        result.calls.some((call) => call.startsWith("develop ")),
        false,
      );
  });
}

test("CI main skips a push with no net file changes", (t) => {
  const f = fixture(t);
  f.git("commit", "--allow-empty", "-qm", "ci: empty commit\n\nChange: fix");
  const result = f.run("main");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, []);
});

test("CI rejects invalid manifest JSON before selecting release checks", (t) => {
  const f = fixture(t);
  f.write("package.json", "{broken\n");
  f.commit();
  const result = f.run("pr");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read package.json at HEAD/);
  assert.deepEqual(result.calls, []);
});

test("CI rejects missing history, empty changes and invalid commit messages before Nix", (t) => {
  const f = fixture(t);
  for (const base of ["missing-commit", f.base]) {
    const result = f.run("pr", base);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Next:/);
    assert.deepEqual(result.calls, []);
  }
  f.write("README.md", "# Guide\n");
  f.commit("invalid subject");
  const result = f.run("pr");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /subject/);
  assert.deepEqual(result.calls, []);
});
