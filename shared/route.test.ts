import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { onRoutePart, ROUTES_CHAINS, routedChain, routePart } from "./route.ts";

test("the first extension that knows a part gives its route", () => {
  const pi = { events: createEventBus() };
  onRoutePart(pi, (part) => (part.startsWith("git ") ? { command: "git --no-pager log" } : undefined));
  onRoutePart(pi, (part) => ({ block: `no ${part}` }));
  assert.deepEqual(routePart(pi, "git log"), { command: "git --no-pager log" });
  assert.deepEqual(routePart(pi, "cat a"), { block: "no cat a" });
});

test("no route without an extension that knows the part", () => {
  assert.equal(routePart({ events: createEventBus() }, "ls"), undefined);
});

test("a chain is routed only when the bash tool answers and the command has more than one part", () => {
  const pi = { events: createEventBus() };
  assert.equal(routedChain(pi, "cd a && git log"), false);
  pi.events.on(ROUTES_CHAINS, (q) => {
    (q as { on: boolean }).on = true;
  });
  assert.equal(routedChain(pi, "cd a && git log"), true);
  assert.equal(routedChain(pi, "git log"), false);
  assert.equal(routedChain(pi, "echo 'a"), false);
});
