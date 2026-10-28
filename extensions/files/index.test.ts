import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { routePart } from "../../shared/route.ts";
import files from "./index.ts";

function load() {
  const events = createEventBus();
  const handlers = new Map<string, any[]>();
  files({
    events,
    registerTool() {},
    on: (event: string, h: any) => handlers.set(event, [...(handlers.get(event) ?? []), h]),
  } as any);
  const call = (event: string, payload: any, ctx: any = {}) => (handlers.get(event) ?? []).map((h) => h(payload, ctx)).find(Boolean);
  return { events, call };
}

test("a file view in bash runs, and gets the read tool", () => {
  const { events, call } = load();
  assert.equal(call("tool_call", { toolName: "bash", input: { command: "cat README.md" } }), undefined);
  assert.equal(routePart({ events }, "cat README.md")?.command, "cat -- README.md");
  assert.equal(routePart({ events }, "just check"), undefined);
});
