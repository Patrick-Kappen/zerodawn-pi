import assert from "node:assert/strict";
import { test } from "node:test";
import files from "./index.ts";

function load() {
  const tools = new Map<string, any>();
  const handlers = new Map<string, any[]>();
  files({
    registerTool: (t: any) => tools.set(t.name, t),
    on: (event: string, h: any) => handlers.set(event, [...(handlers.get(event) ?? []), h]),
  } as any);
  const call = (event: string, payload: any, ctx: any = {}) => (handlers.get(event) ?? []).map((h) => h(payload, ctx)).find(Boolean);
  return { tools, call };
}

test("a file view in bash is blocked with the read and grep hint", () => {
  const { call } = load();
  const r = call("tool_call", { toolName: "bash", input: { command: "cat README.md" } });
  assert.equal(r.block, true);
  assert.match(r.reason, /use grep to find the lines, then read with offset and limit/);
  assert.equal(call("tool_call", { toolName: "bash", input: { command: "just check" } }), undefined);
});
