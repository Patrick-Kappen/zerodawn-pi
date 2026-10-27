import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/test-changed.sh", import.meta.url));

const cases = [
  { files: ["extensions/checker/index.ts"], expected: ["bun", "test", "./extensions/checker", "./integration"] },
  {
    files: ["extensions/checker/index.ts", "extensions/checker/index.test.ts", "integration/background-checker.test.ts"],
    expected: ["bun", "test", "./extensions/checker", "./integration"],
  },
  { files: ["integration/release.test.ts"], expected: ["bun", "test", "./integration"] },
  { files: ["shared/config.ts"], expected: ["bun", "test"] },
  { files: ["scripts/bump-changed.sh"], expected: ["nix", "flake", "check", "--option", "warn-dirty", "false"] },
];

test("changed files select the affected tests and keep cross-extension contracts in scope", (t) => {
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
});
