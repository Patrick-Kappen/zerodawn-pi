import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { ROUTES_CHAINS, routePart } from "../../shared/route.ts";
import git from "./index.ts";

function load(bashRoutes: boolean) {
  const handlers = new Map<string, (event: any) => any>();
  const pi = { events: createEventBus(), on: (name: string, fn: (event: any) => any) => handlers.set(name, fn), registerTool() {} };
  if (bashRoutes)
    pi.events.on(ROUTES_CHAINS, (q) => {
      (q as { on: boolean }).on = true;
    });
  git(pi as any);
  const call = (command: string) => handlers.get("tool_call")!({ toolName: "bash", input: { command } });
  return { pi, call };
}

test("a git read in bash is refused, also in a chain that bash does not route", () => {
  assert.match(load(true).call("git log -3")?.reason, /use the git tool/);
  assert.match(load(false).call("cd x && git log -3")?.reason, /use the git tool/);
});

test("a chain that bash routes passes, and its git part gets the git tool", () => {
  const { pi, call } = load(true);
  assert.equal(call("cd x && git log -3"), undefined);
  assert.deepEqual((routePart(pi, "git log -3") as { command: string }).command, "git --no-pager log --oneline --no-decorate -n3");
});
