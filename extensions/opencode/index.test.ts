import assert from "node:assert/strict";
import { test } from "node:test";
import register from "./index.ts";

test("the opencode description says when and how to use it, without separate guidelines", () => {
  const tools: any[] = [];
  register({ registerTool: (t: any) => tools.push(t), on() {}, registerCommand() {} } as any);
  const tool = tools.find((t) => t.name === "opencode");
  assert.match(tool.description, /Use it for a clear task that does not need this session's context/);
  assert.match(tool.description, /check its changes with git diff and the tests/);
  assert.equal(tool.promptGuidelines, undefined);
});
