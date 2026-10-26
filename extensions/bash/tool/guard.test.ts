import assert from "node:assert/strict";
import { test } from "node:test";
import { createState } from "../state.ts";
import { registerWaitGuard, waitsOnly } from "./guard.ts";

const waiting = ["sleep 30", "sleep 5; sleep 5", "sleep 10 && wait", "true"];
const working = ["sleep 2 && ls", "nix build .#x", "echo 'sleep 5'", "timeout 30 bash -c 'until curl -s localhost; do sleep 1; done' && ls", ""];
for (const c of waiting) test(`waits only: ${c}`, () => assert.equal(waitsOnly(c), true, c));
for (const c of working) test(`does work: ${c || "(empty)"}`, () => assert.equal(waitsOnly(c), false, c));

test("a bare wait is blocked, with the chain form as the reason", () => {
  let handler: (event: { toolName: string; input: unknown }) => { block?: boolean; reason?: string } | undefined = () => undefined;
  registerWaitGuard({ on: (_name: string, fn: typeof handler) => (handler = fn) } as never, createState());
  assert.match(handler({ toolName: "bash", input: { command: "sleep 5" } })?.reason ?? "", /^chain the wait/);
  assert.equal(handler({ toolName: "bash", input: { command: "sleep 1; ls" } }), undefined);
});
