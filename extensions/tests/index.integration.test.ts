import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { ROUTES_CHAINS, routePart } from "../../shared/route.ts";
import extension from "./index.ts";

const handlers = new Map<string, (event: any, ctx?: any) => any>();
const tools: any[] = [];
const events = createEventBus();
events.on(ROUTES_CHAINS, (q) => {
  (q as { on: boolean }).on = true;
});
extension({ events, on: (name: string, fn: any) => handlers.set(name, fn), registerTool: (t: any) => tools.push(t), sendMessage: () => {} } as any);

const dir = mkdtempSync(join(tmpdir(), "tests-index-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const bash = (command: string, id = "c1", input: Record<string, unknown> = { command }) =>
  handlers.get("tool_call")?.({ toolName: "bash", toolCallId: id, input }, { cwd: dir });
const result = (id: string) => handlers.get("tool_result")?.({ toolName: "bash", toolCallId: id, content: [{ type: "text", text: "out" }] });

test("registers run_tests with a schema for scope and path", () => {
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "run_tests");
  assert.deepEqual(Object.keys(tools[0].parameters.properties), ["scope", "path"]);
});

test("recipes go into the system prompt; a test command in bash runs run_tests, without a block; other commands run", async () => {
  writeFileSync(join(dir, "Makefile"), "# Build it\nbuild:\n\tcc main.c\n");
  const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
  handlers.get("before_agent_start")?.(event, { cwd: dir });
  assert.match(event.systemPromptOptions.sections.project_recipes, /- make build: Build it/);
  const input: Record<string, unknown> = { command: "cd x && bun test" };
  assert.equal(await bash("", "t1", input), undefined);
  assert.deepEqual(input, { command: ":" });
  const replaced = await result("t1");
  assert.equal(replaced.isError, true);
  assert.equal(replaced.terminate, undefined, "the agent goes on with other work");
  assert.match(replaced.content[0].text, /^run_tests result \(use run_tests next time\):\nrun_tests: "git rev-parse --show-toplevel" failed/);
  assert.equal(await result("t1"), undefined);
  assert.match((await bash("cc main.c"))?.reason, /Run "make build"/);
  assert.equal(await bash("ls"), undefined);
});

test("in a chain with other commands, bash runs the test and check parts, and they get a short result", async () => {
  const input: Record<string, unknown> = { command: "git add . && bun test && just lint && git commit -m x" };
  assert.equal(await bash("", "m1", input), undefined);
  assert.deepEqual(input, { command: "git add . && bun test && just lint && git commit -m x" });
  const tests = routePart({ events }, "bun test") as { command: string; format: (out: string, exit: number) => string };
  assert.equal(tests.command, "bun test");
  assert.equal(tests.format("a\n 3 pass\n 0 fail\n", 0), "tests green: 3 pass, 0 fail");
  const check = routePart({ events }, "just lint") as { format: (out: string, exit: number) => string };
  assert.match(
    check.format("src/a.ts:1:2 lint/x\n! bad\nerror: lint failed", 1),
    /^check red: exit 1 · 1 warning lines\nA warning is an error here: fix each one\.\nsrc\/a\.ts:1:2: lint\/x\n/,
  );
  assert.equal(routePart({ events }, "git add ."), undefined);
});

test("a long command that runs the third time gets a hint in its result", async () => {
  const long = `echo ${"x".repeat(80)}`;
  for (const id of ["a", "b", "c"]) await bash(long, id);
  assert.match((await result("c")).content[0].text, /^out\nThis command ran 3 times\. Add it as a recipe/);
});
