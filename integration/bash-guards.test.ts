import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import bash from "../extensions/bash/index.ts";
import { routeChain } from "../extensions/bash/tool/chain.ts";
import files from "../extensions/files/index.ts";
import git from "../extensions/git/index.ts";
import tests from "../extensions/tests/index.ts";
import { routePart } from "../shared/route.ts";
import { createHarness, extensionLoadOrder } from "./harness.ts";

/** Locks the current links between bash, files, git and tests for a bash command, loaded in the real order. */

const ALL = { bash, files, git, tests } as const;
const order = extensionLoadOrder().filter((name) => name in ALL);
assert.deepEqual(order, ["bash", "files", "git", "tests"], "the load order of the extensions that route bash changed");

const root = mkdtempSync(join(tmpdir(), "bash-guards-"));
const sh = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
sh("init", "-q");
sh("config", "user.email", "t@example.com");
sh("config", "user.name", "t");
writeFileSync(join(root, "README.md"), "x\n");
sh("add", "-A");
sh("commit", "-q", "-m", "init");

const h = createHarness({ root, extensions: order.map((name) => ({ name, register: ALL[name as keyof typeof ALL] as (pi: any) => void })) });
after(() => h.close());

const NO_OP = ":";

let n = 0;
const call = async (command: string) => {
  const result = await h.toolCall("bash", `guard-${++n}`, { command });
  return { ...result, command: result.input.command as string };
};

test("handlers of tool_call run in the load order bash, files, tests; git and files route through events", () => {
  assert.deepEqual(h.owners("tool_call"), ["bash", "files", "tests"]);
});

test("git reads, file views and plain commands pass tool_call unchanged; bash routes them later", async () => {
  for (const command of ["git log", "git -C x status", "cd x && git diff", "foo & git log", "cat README.md", "sed -n 1p README.md", "echo ok"]) {
    const r = await call(command);
    assert.equal(r.block, false, command);
    assert.equal(r.reason, undefined, command);
    assert.equal(r.command, command);
  }
});

test("bash wait guard blocks sleep 5 and names the chain form", async () => {
  const r = await call("sleep 5");
  assert.equal(r.block, true);
  assert.match(r.reason ?? "", /^chain the wait with its next step: timeout 30 bash -c/);
  assert.equal(r.command, "sleep 5");
});

test("tests replaces a lone test or check command with a no-op and does not block", async () => {
  for (const command of ["just test", "just check"]) {
    const r = await call(command);
    assert.equal(r.block, false, command);
    assert.equal(r.command, NO_OP, command);
  }
});

test("a chain with a test or check and another part stays as written, so bash runs every part", async () => {
  for (const command of ["just test && git commit -m x", "git commit -m x && just check"]) {
    const r = await call(command);
    assert.equal(r.block, false, command);
    assert.equal(r.command, command);
  }
});

test("routes of single parts: git and files give their tool command, tests keeps the command, others have no route", () => {
  assert.match(routePart(h.api, "git log")?.command ?? "", /^git --no-pager log\b/);
  assert.match(routePart(h.api, "git -C x status")?.command ?? "", /^git -C x --no-pager status\b/);
  assert.equal(routePart(h.api, "cat README.md")?.command, "cat -- README.md");
  assert.equal(routePart(h.api, "sed -n 1p README.md")?.command, "cat -- README.md");
  assert.equal(routePart(h.api, "just test")?.command, "just test");
  assert.equal(routePart(h.api, "git commit -m x"), undefined);
  assert.equal(routePart(h.api, "echo ok"), undefined);
});

test("routes of chains: only the known parts get a format; a background part runs as written", () => {
  const background = routeChain(h.api, "foo & git log");
  assert.ok(background);
  assert.ok(background.script.startsWith("foo &"), background.script);
  assert.deepEqual([...background.formats.keys()], [1]);

  const commit = routeChain(h.api, "just test && git commit -m x");
  assert.ok(commit);
  assert.ok(commit.script.endsWith("&& git commit -m x"), commit.script);
  assert.deepEqual([...commit.formats.keys()], [0]);

  assert.equal(routeChain(h.api, "echo ok && git commit -m x"), undefined);
});

test("routing: a replaced test command gives the run_tests text instead of the bash output", async () => {
  const input = { command: "just test" };
  const r = await h.toolCall("bash", "route-test", input);
  assert.equal(r.block, false);
  assert.equal(input.command, NO_OP);
  const result = await h.toolResult("bash", "route-test", input, [{ type: "text", text: "BASH OUTPUT" }]);
  assert.ok(result, "the tests extension must replace the result");
  const text = result.content[0].text as string;
  assert.ok(text.startsWith("run_tests result (use run_tests next time):\n"), text);
  assert.ok(!text.includes("BASH OUTPUT"));
  assert.equal(typeof result.isError, "boolean");
});

test("routing: a replaced check command gives the check text instead of the bash output", async () => {
  const input = { command: "just check" };
  const r = await h.toolCall("bash", "route-check", input);
  assert.equal(r.block, false);
  assert.equal(input.command, NO_OP);
  const result = await h.toolResult("bash", "route-check", input, [{ type: "text", text: "BASH OUTPUT" }]);
  assert.ok(result, "the tests extension must replace the result");
  const text = result.content[0].text as string;
  assert.ok(text.startsWith("Check result (do not run it again in another form):\n"), text);
  assert.ok(!text.includes("BASH OUTPUT"));
});

test("routing: a plain bash command keeps its output", async () => {
  const input = { command: "echo ok" };
  await h.toolCall("bash", "route-plain", input);
  const result = await h.toolResult("bash", "route-plain", input, [{ type: "text", text: "ok" }]);
  assert.equal(result, undefined);
});
