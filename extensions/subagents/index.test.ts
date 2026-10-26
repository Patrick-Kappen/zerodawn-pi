import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";

function load(env: Record<string, string | undefined>): string[] {
  const keys = ["PI_SUBAGENT_SOCKET", "PI_SUBAGENT_ID", "PI_SUBAGENT_CHECKS"] as const;
  const saved = keys.map((key) => [key, process.env[key]] as const);
  const tools: string[] = [];
  const pi = {
    registerTool: (tool: { name: string }) => tools.push(tool.name),
    on: () => () => {},
  } as unknown as ExtensionAPI;
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    extension(pi);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return tools;
}

test("in the main pi the extension registers only the tool subagent", () => {
  assert.deepEqual(load({ PI_SUBAGENT_SOCKET: undefined, PI_SUBAGENT_ID: undefined, PI_SUBAGENT_CHECKS: undefined }), ["subagent"]);
});

test("in a subagent the extension registers ask, blocker, handoff, done and done_findings, not subagent", () => {
  const tools = load({ PI_SUBAGENT_SOCKET: "/tmp/x.sock", PI_SUBAGENT_ID: "a", PI_SUBAGENT_CHECKS: "[]" });
  assert.deepEqual([...tools].sort(), ["ask", "blocker", "done", "done_findings", "handoff"]);
});

test("one of the two subagent variables alone fails", () => {
  assert.throws(() => load({ PI_SUBAGENT_SOCKET: "/tmp/x.sock", PI_SUBAGENT_ID: undefined }));
});
