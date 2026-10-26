import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { nodeFiles, profilePath, resolveProfile } from "./resolve.ts";

const home = await mkdtemp(join(tmpdir(), "pi-subagents-resolve-"));
after(() => rm(home, { recursive: true, force: true }));

async function profile(name: string, frontmatter: string, prompt = "Prompt  with 'quotes' and $VAR"): Promise<void> {
  const dir = join(home, ".pi", "agent", "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), `---\ndescription: d\nmodels: [m/one:off, m/two]\n${frontmatter}\n---\n${prompt}\n`);
}

test("profilePath accepts only plain names", () => {
  assert.equal(profilePath("/h", "scout-2"), "/h/.pi/agent/agents/scout-2.md");
  for (const bad of ["", "../x", "A", "-a", "a/b", "a.md"]) assert.throws(() => profilePath("/h", bad), /not valid/);
});

test("missing profile names the path", async () => {
  await assert.rejects(resolveProfile(home, "nope", nodeFiles), (error: Error) => error.message.includes(join(home, ".pi/agent/agents/nope.md")));
});

test("builtin, package extension, skill, tools, first model and prompt as one argument", async () => {
  const ext = join(home, ".pi/agent/packages/pkg-b/extensions/files");
  await mkdir(ext, { recursive: true });
  await writeFile(join(ext, "index.ts"), "");
  await mkdir(join(home, ".pi/agent/packages/pkg-a"), { recursive: true });
  await mkdir(join(home, ".pi/agent/skills/lint"), { recursive: true });
  await profile("full", "extensions: [files, builtin:codemode]\nskills: [lint]\ntools: [read, mcp__gh__*]");
  const { args, profile: loaded } = await resolveProfile(home, "full", nodeFiles);
  assert.deepEqual(args, [
    "-e",
    join(ext, "index.ts"),
    "-e",
    "builtin:codemode",
    "--skill",
    join(home, ".pi/agent/skills/lint"),
    "--tools",
    "read,mcp__gh__*,ask,blocker,handoff,done,done_findings",
    "--model",
    "m/one:off",
    "--system-prompt",
    "Prompt  with 'quotes' and $VAR",
  ]);
  assert.deepEqual(loaded.models, ["m/one:off", "m/two"]);
});

test("--tools always has ask, blocker, handoff, done and done_findings; a tool list without mcp__ gives --no-mcp", async () => {
  await profile("none", "tools: []");
  assert.deepEqual((await resolveProfile(home, "none", nodeFiles)).args.slice(0, 3), ["--tools", "ask,blocker,handoff,done,done_findings", "--no-mcp"]);
  await profile("some", "tools: [read]");
  assert.deepEqual((await resolveProfile(home, "some", nodeFiles)).args.slice(0, 3), ["--tools", "read,ask,blocker,handoff,done,done_findings", "--no-mcp"]);
  await profile("absent", "");
  assert.deepEqual((await resolveProfile(home, "absent", nodeFiles)).args.slice(0, 3), ["--tools", "ask,blocker,handoff,done,done_findings", "--no-mcp"]);
});

test("missing extension and missing skill are errors with names and paths", async () => {
  await profile("badext", "extensions: [ghost]");
  await assert.rejects(resolveProfile(home, "badext", nodeFiles), /extension "ghost".*packages\/\*\/extensions\/ghost\/index\.ts/);
  await profile("badskill", "skills: [ghost]");
  await assert.rejects(resolveProfile(home, "badskill", nodeFiles), (error: Error) => error.message.includes(join(home, ".pi/agent/skills/ghost")));
  const empty = await mkdtemp(join(tmpdir(), "pi-subagents-resolve-empty-"));
  try {
    await mkdir(join(empty, ".pi/agent/agents"), { recursive: true });
    await writeFile(join(empty, ".pi/agent/agents/e.md"), "---\ndescription: d\nmodels: [m]\nextensions: [x]\n---\nP\n");
    await assert.rejects(resolveProfile(empty, "e", nodeFiles), /packages directory .*does not exist/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
