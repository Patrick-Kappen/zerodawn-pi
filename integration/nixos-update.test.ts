import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/ci-nixos-update.sh", import.meta.url));

function fakeGh(t: { after: (fn: () => void) => void }, exitCode: number) {
  const root = mkdtempSync(join(tmpdir(), "pi-nixos-update-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "gh.log");
  const shell = execFileSync("bash", ["-c", 'printf "%s" "$BASH"'], { encoding: "utf8", timeout: 5000 });
  writeFileSync(join(bin, "gh"), `#!${shell}\nprintf '%s\\n' "$*" >>'${log}'\ncat >>'${log}'\nexit ${exitCode}\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function run(env: NodeJS.ProcessEnv, args: string[]) {
  const result = spawnSync("bash", [script, ...args], { env, encoding: "utf8", timeout: 5000 });
  if (result.error) throw result.error;
  return result;
}

test("a release sends the input and the tag to the Nixos pi-release workflow", (t) => {
  const { log, env } = fakeGh(t, 0);
  const result = run({ ...env, GH_TOKEN: "token" }, ["zerodawn-pi", "v0.20.0"]);
  assert.equal(result.status, 0, result.stderr);
  const [args, ...body] = readFileSync(log, "utf8").split("\n");
  assert.equal(args, "api repos/Patrick-Kappen/Nixos/dispatches --input -");
  assert.deepEqual(JSON.parse(body.join("\n")), {
    event_type: "pi-release",
    client_payload: { input: "zerodawn-pi", tag: "v0.20.0" },
  });
});

test("a missing token fails and names the secret and the manual run", (t) => {
  const { env } = fakeGh(t, 0);
  const result = run({ ...env, GH_TOKEN: "" }, ["zerodawn-pi", "v0.20.0"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NIXOS_UPDATE_TOKEN is missing/);
  assert.match(result.stderr, /gh workflow run pi-release\.yml -R Patrick-Kappen\/Nixos -f input=zerodawn-pi -f tag=v0\.20\.0/);
});

test("a failed dispatch fails and names the manual run", (t) => {
  const { env } = fakeGh(t, 1);
  const result = run({ ...env, GH_TOKEN: "token" }, ["zerodawn-pi", "v0.20.0"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot send the pi-release event/);
  assert.match(result.stderr, /gh workflow run pi-release\.yml/);
});

test("missing arguments fail with the usage", (t) => {
  const { env } = fakeGh(t, 0);
  const result = run({ ...env, GH_TOKEN: "token" }, ["zerodawn-pi"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: ci-nixos-update\.sh INPUT TAG/);
});
