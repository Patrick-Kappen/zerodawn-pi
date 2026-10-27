import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_SCRIPTS = join(SOURCE_ROOT, "scripts");
const SCRIPTS = ["bump-changed.sh", "notes.sh", "release-check.sh"];
const DAY = "\\d{4}-\\d{2}-\\d{2}";

function assertDated(actual: string, expected: string): void {
  const pattern = expected
    .split("{date}")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(DAY);
  assert.match(actual, new RegExp(`^${pattern}$`));
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

interface Component {
  name: string;
  version: string;
}

interface RepoOptions {
  packageVersion: string;
  shared: Component;
  extensions: Component[];
}

type Change = "fix" | "feature" | "breaking";

interface Fixture {
  git(...args: string[]): Promise<string>;
  script(name: string, ...args: string[]): Promise<Result>;
  commit(files: Record<string, string>, subject: string, change?: Change): Promise<void>;
  read(path: string): Promise<string>;
  json(path: string): Promise<Component>;
  head(): Promise<string>;
  status(): Promise<string>;
}

function exec(command: string, args: string[], cwd: string, env: Record<string, string | undefined>): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null && typeof error.code !== "number") {
        reject(new Error(`Could not run ${command} in ${cwd}; check the test environment.`, { cause: error }));
        return;
      }
      resolve({ code: error === null ? 0 : (error.code as number), stdout, stderr });
    });
  });
}

async function createFixture(t: { after(fn: () => Promise<void>): void }, options: RepoOptions): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "pi-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "proj");
  const configHome = join(root, "config");
  const hooks = join(root, "hooks");
  await mkdir(repo);
  await mkdir(configHome);
  await mkdir(hooks);
  const env: Record<string, string | undefined> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    XDG_CONFIG_HOME: configHome,
  };

  const run = (command: string, args: string[]) => exec(command, args, repo, env);
  const write = async (path: string, content: string) => {
    const file = join(repo, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  };
  const git = async (...args: string[]) => {
    const result = await run("git", args);
    assert.equal(result.code, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };

  await git("init", "-q", "--template=", "-b", "main");
  await git("config", "user.email", "release-test@example.com");
  await git("config", "user.name", "Release Test");
  await git("config", "core.hooksPath", hooks);
  await git("config", "commit.gpgsign", "false");
  await git("config", "tag.gpgsign", "false");

  await cp(join(SOURCE_ROOT, "biome.json"), join(repo, "biome.json"));
  await mkdir(join(repo, "scripts"));
  const shell = await run("bash", ["-c", 'printf "%s" "$BASH"']);
  assert.equal(shell.code, 0, shell.stderr);
  for (const name of SCRIPTS) {
    const source = await readFile(join(SOURCE_SCRIPTS, name), "utf8");
    await writeFile(join(repo, "scripts", name), source.replace(/^#!.*$/m, `#!${shell.stdout}`), { mode: 0o755 });
  }

  const writeJSON = async (path: string, value: unknown) => write(path, `${JSON.stringify(value, null, 2)}\n`);
  const changelog = (version: string) => `# Changelog\n\n## ${version} — 2026-01-01\n\n- old\n`;
  await writeJSON("package.json", { name: "zerodawn-pi", version: options.packageVersion, private: true });
  await write("README.md", "# Pi\n");
  await write("CHANGELOG.md", changelog(options.packageVersion));
  await writeJSON("shared/package.json", options.shared);
  await write("shared/README.md", "# Shared\n");
  await write("shared/CHANGELOG.md", changelog(options.shared.version));
  for (const extension of options.extensions) {
    await writeJSON(`extensions/${extension.name}/package.json`, extension);
    await write(`extensions/${extension.name}/README.md`, `# ${extension.name[0]?.toUpperCase()}${extension.name.slice(1)}\n`);
    await write(`extensions/${extension.name}/CHANGELOG.md`, changelog(extension.version));
  }

  const notes = await run("bash", [join(repo, "scripts", "notes.sh")]);
  assert.equal(notes.code, 0, notes.stderr);
  await git("add", "-A");
  await git("commit", "-q", "-m", "initial");
  await git("tag", `v${options.packageVersion}`);
  await git("tag", `${options.shared.name}-v${options.shared.version}`);
  for (const extension of options.extensions) await git("tag", `${extension.name}-v${extension.version}`);

  const fixture: Fixture = {
    git,
    script: (name, ...args) => run("bash", [join(repo, "scripts", name), ...args]),
    commit: async (files, subject, change) => {
      for (const [path, content] of Object.entries(files)) await write(path, content);
      await git("add", "-A");
      const args = ["commit", "-q", "-m", subject];
      if (change) args.push("-m", `Change: ${change}`);
      await git(...args);
    },
    read: (path) => readFile(join(repo, path), "utf8"),
    json: async (path) => JSON.parse(await readFile(join(repo, path), "utf8")) as Component,
    head: () => git("rev-parse", "HEAD"),
    status: () => git("status", "--porcelain"),
  };
  return fixture;
}

const version = async (fixture: Fixture, path: string) => (await fixture.json(path)).version;

test("patch: bumps the changed extension and the package, leaves unchanged components and writes notes", async (t) => {
  const fixture = await createFixture(t, {
    packageVersion: "0.4.0",
    shared: { name: "shared", version: "0.3.0" },
    extensions: [
      { name: "alpha", version: "0.2.0" },
      { name: "beta", version: "0.1.0" },
    ],
  });
  const before = await fixture.head();
  await fixture.commit({ "extensions/alpha/index.ts": "export const parser = 1;\n" }, "alpha: tighten parser", "fix");
  await fixture.commit({ "docs/guide.md": "Use the parser.\n" }, "docs: explain the parser", "fix");

  const result = await fixture.script("bump-changed.sh");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "package 0.4.0 -> 0.4.1\nalpha 0.2.0 -> 0.2.1\n");
  assert.equal(result.stderr, "");

  assert.equal(await version(fixture, "package.json"), "0.4.1");
  assert.equal(await version(fixture, "extensions/alpha/package.json"), "0.2.1");
  assert.equal(await version(fixture, "extensions/beta/package.json"), "0.1.0");
  assert.equal(await version(fixture, "shared/package.json"), "0.3.0");

  assertDated(await fixture.read("extensions/alpha/CHANGELOG.md"), `# Changelog\n\n## 0.2.1 — {date}\n\n- tighten parser\n\n## 0.2.0 — 2026-01-01\n\n- old\n`);
  assertDated(
    await fixture.read("CHANGELOG.md"),
    `# Changelog\n\n## 0.4.1 — {date}\n\n### alpha 0.2.1\n\n- tighten parser\n\n### repository\n\n- docs: explain the parser\n\n## 0.4.0 — 2026-01-01\n\n- old\n`,
  );
  assertDated(
    await fixture.read("extensions/alpha/README.md"),
    `# Alpha\n\n## Changes\n\n<!-- changelog:start -->\n## 0.2.1 — {date}\n\n- tighten parser\n\n[All changes](CHANGELOG.md)\n<!-- changelog:end -->\n`,
  );
  assert.equal(
    await fixture.read("extensions/beta/README.md"),
    "# Beta\n\n## Changes\n\n<!-- changelog:start -->\n## 0.1.0 — 2026-01-01\n\n- old\n\n[All changes](CHANGELOG.md)\n<!-- changelog:end -->\n",
  );
  assert.equal(
    await fixture.read("shared/README.md"),
    "# Shared\n\n## Changes\n\n<!-- changelog:start -->\n## 0.3.0 — 2026-01-01\n\n- old\n\n[All changes](CHANGELOG.md)\n<!-- changelog:end -->\n",
  );
  assert.match(await fixture.read("README.md"), /## 0\.4\.1 — \d{4}-\d{2}-\d{2}/);
  assert.match(await fixture.read("README.md"), /### alpha 0\.2\.1/);
  assert.match(await fixture.read("README.md"), /\[All changes\]\(CHANGELOG\.md\)/);

  assert.notEqual(await fixture.head(), before);
  assert.equal(await fixture.git("log", "-1", "--format=%s"), "release: v0.4.1");
  assert.equal(await fixture.git("log", "-1", "--format=%b"), "alpha 0.2.0 -> 0.2.1");
  assert.equal(await fixture.status(), "");

  const check = await fixture.script("release-check.sh");
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.stdout, "release-check: every changed extension has a new version, README changelog blocks are current\n");
  assert.equal(await fixture.status(), "");
});

test("feature: takes the highest level per component and for the package", async (t) => {
  const fixture = await createFixture(t, {
    packageVersion: "0.5.0",
    shared: { name: "shared", version: "0.4.0" },
    extensions: [
      { name: "alpha", version: "0.3.0" },
      { name: "beta", version: "0.2.0" },
    ],
  });
  await fixture.commit({ "extensions/alpha/index.ts": "export const option = true;\n" }, "alpha: add an option", "feature");
  await fixture.commit({ "extensions/beta/index.ts": "export const parser = 2;\n" }, "beta: fix the parser", "fix");
  await fixture.commit({ "extensions/alpha/index.ts": "export const option = false;\n" }, "alpha: fix the option", "fix");
  await fixture.commit({ "docs/options.md": "Options.\n" }, "docs: describe the options", "fix");

  const result = await fixture.script("bump-changed.sh");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "package 0.5.0 -> 0.6.0\nalpha 0.3.0 -> 0.4.0\nbeta 0.2.0 -> 0.2.1\n");

  assert.equal(await version(fixture, "package.json"), "0.6.0");
  assert.equal(await version(fixture, "extensions/alpha/package.json"), "0.4.0");
  assert.equal(await version(fixture, "extensions/beta/package.json"), "0.2.1");
  assert.equal(await version(fixture, "shared/package.json"), "0.4.0");

  assertDated(
    await fixture.read("extensions/alpha/CHANGELOG.md"),
    `# Changelog\n\n## 0.4.0 — {date}\n\n- fix the option\n\n- add an option\n\n## 0.3.0 — 2026-01-01\n\n- old\n`,
  );
  assertDated(await fixture.read("extensions/beta/CHANGELOG.md"), `# Changelog\n\n## 0.2.1 — {date}\n\n- fix the parser\n\n## 0.2.0 — 2026-01-01\n\n- old\n`);
  const root = await fixture.read("CHANGELOG.md");
  assert.match(root, /## 0\.6\.0 — \d{4}-\d{2}-\d{2}/);
  assert.match(root, /### alpha 0\.4\.0\n\n- fix the option\n\n- add an option/);
  assert.match(root, /### beta 0\.2\.1\n\n- fix the parser/);
  assert.match(root, /### repository\n\n- docs: describe the options/);
  assert.equal(await fixture.status(), "");

  const check = await fixture.script("release-check.sh");
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.stdout, "release-check: every changed extension has a new version, README changelog blocks are current\n");
});

test("breaking: major at 1.0 and above, minor below 1.0, marked in the changelog", async (t) => {
  const fixture = await createFixture(t, {
    packageVersion: "1.4.2",
    shared: { name: "shared", version: "0.5.0" },
    extensions: [
      { name: "alpha", version: "0.3.2" },
      { name: "gamma", version: "1.2.3" },
    ],
  });
  await fixture.commit({ "extensions/alpha/index.ts": "export const api = 2;\n" }, "alpha: change the api", "breaking");
  await fixture.commit({ "extensions/gamma/index.ts": "export const api = 2;\n" }, "gamma: change the api", "breaking");
  await fixture.commit({ "docs/api.md": "The new API.\n" }, "docs: document the new api", "fix");

  const result = await fixture.script("bump-changed.sh");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "package 1.4.2 -> 2.0.0\nalpha 0.3.2 -> 0.4.0\ngamma 1.2.3 -> 2.0.0\n");

  assert.equal(await version(fixture, "package.json"), "2.0.0");
  assert.equal(await version(fixture, "extensions/alpha/package.json"), "0.4.0");
  assert.equal(await version(fixture, "extensions/gamma/package.json"), "2.0.0");
  assert.equal(await version(fixture, "shared/package.json"), "0.5.0");

  assertDated(
    await fixture.read("extensions/alpha/CHANGELOG.md"),
    `# Changelog\n\n## 0.4.0 — {date}\n\n- change the api (breaking)\n\n## 0.3.2 — 2026-01-01\n\n- old\n`,
  );
  assertDated(
    await fixture.read("extensions/gamma/CHANGELOG.md"),
    `# Changelog\n\n## 2.0.0 — {date}\n\n- change the api (breaking)\n\n## 1.2.3 — 2026-01-01\n\n- old\n`,
  );
  const root = await fixture.read("CHANGELOG.md");
  assert.match(root, /## 2\.0\.0 — \d{4}-\d{2}-\d{2}/);
  assert.match(root, /### alpha 0\.4\.0\n\n- change the api \(breaking\)/);
  assert.match(root, /### gamma 2\.0\.0\n\n- change the api \(breaking\)/);
  assert.equal(await fixture.status(), "");

  const check = await fixture.script("release-check.sh");
  assert.equal(check.code, 0, check.stderr);
});

test("a commit without a Change trailer is rejected before anything changes", async (t) => {
  const fixture = await createFixture(t, {
    packageVersion: "0.4.0",
    shared: { name: "shared", version: "0.3.0" },
    extensions: [{ name: "alpha", version: "0.2.0" }],
  });
  await fixture.commit({ "extensions/alpha/index.ts": "export const parser = 1;\n" }, "alpha: no trailer");
  const before = {
    head: await fixture.head(),
    package: await fixture.read("package.json"),
    changelog: await fixture.read("extensions/alpha/CHANGELOG.md"),
    readme: await fixture.read("extensions/alpha/README.md"),
  };
  const short = await fixture.git("rev-parse", "--short", "HEAD");

  const result = await fixture.script("bump-changed.sh");
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    `bump-changed: these commits have no "Change:" trailer:\n  ${short} alpha: no trailer\nNext: run again with the change of these commits: just bump-changed fix|feature|breaking\n`,
  );

  assert.equal(await fixture.head(), before.head);
  assert.equal(await fixture.read("package.json"), before.package);
  assert.equal(await fixture.read("extensions/alpha/CHANGELOG.md"), before.changelog);
  assert.equal(await fixture.read("extensions/alpha/README.md"), before.readme);
  assert.equal(await version(fixture, "extensions/alpha/package.json"), "0.2.0");
  assert.equal(await fixture.status(), "");
});

test("an empty release request is rejected before package.json changes", async (t) => {
  const fixture = await createFixture(t, {
    packageVersion: "0.4.0",
    shared: { name: "shared", version: "0.3.0" },
    extensions: [{ name: "alpha", version: "0.2.0" }],
  });
  const before = {
    head: await fixture.head(),
    package: await fixture.read("package.json"),
    rootChangelog: await fixture.read("CHANGELOG.md"),
    readme: await fixture.read("README.md"),
    status: await fixture.status(),
  };

  const result = await fixture.script("bump-changed.sh");
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "bump-changed: no commit since v0.4.0; nothing to release\n");

  assert.equal(await fixture.head(), before.head);
  assert.equal(await fixture.read("package.json"), before.package);
  assert.equal(await fixture.read("CHANGELOG.md"), before.rootChangelog);
  assert.equal(await fixture.read("README.md"), before.readme);
  assert.equal(await version(fixture, "package.json"), "0.4.0");
  assert.equal(await version(fixture, "extensions/alpha/package.json"), "0.2.0");
  assert.equal(await fixture.status(), before.status);
});

test("release-check rejects a changed extension that still has its old version", async (t) => {
  const fixture = await createFixture(t, {
    packageVersion: "0.4.0",
    shared: { name: "shared", version: "0.3.0" },
    extensions: [{ name: "alpha", version: "0.2.0" }],
  });
  await fixture.commit({ "extensions/alpha/index.ts": "export const parser = 1;\n" }, "alpha: tighten parser", "fix");
  const before = {
    changelog: await fixture.read("extensions/alpha/CHANGELOG.md"),
    readme: await fixture.read("extensions/alpha/README.md"),
    status: await fixture.status(),
  };

  const result = await fixture.script("release-check.sh");
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "release-check: bump these extensions, for example with just bump-changed:\n  alpha (still 0.2.0, changed since alpha-v0.2.0)\n");

  assert.equal(await fixture.read("extensions/alpha/CHANGELOG.md"), before.changelog);
  assert.equal(await fixture.read("extensions/alpha/README.md"), before.readme);
  assert.equal(await fixture.status(), before.status);
});
