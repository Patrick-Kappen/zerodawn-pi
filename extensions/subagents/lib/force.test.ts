import assert from "node:assert/strict";
import { test } from "node:test";
import { forceTool } from "./force.ts";

test("Anthropic messages: tool_choice names the tool and enabled thinking is removed", () => {
  const payload = { model: "m", max_tokens: 10, messages: [], tools: [{ name: "handoff", input_schema: {} }], thinking: { type: "enabled", budget_tokens: 5 } };
  const forced = forceTool(payload, "handoff");
  assert.deepEqual(forced, { model: "m", max_tokens: 10, messages: [], tools: payload.tools, tool_choice: { type: "tool", name: "handoff" } });
  assert.ok("thinking" in payload);
});

test("Anthropic messages: a tool added during the session as a tool_addition block", () => {
  const addition = { type: "tool_addition", tool: { definition: { name: "handoff", input_schema: {} } } };
  const payload = { model: "m", max_tokens: 10, tools: [{ name: "read", input_schema: {} }], messages: [{ role: "user", content: [addition] }] };
  assert.deepEqual(forceTool(payload, "handoff").tool_choice, { type: "tool", name: "handoff" });
});

test("Anthropic messages: disabled thinking stays", () => {
  const payload = { tools: [{ name: "handoff", input_schema: {} }], thinking: { type: "disabled" } };
  assert.deepEqual(forceTool(payload, "handoff").thinking, { type: "disabled" });
});

test("OpenAI chat completions", () => {
  const payload = { model: "m", messages: [], tools: [{ type: "function", function: { name: "handoff", parameters: {} } }] };
  assert.deepEqual(forceTool(payload, "handoff"), { ...payload, tool_choice: { type: "function", function: { name: "handoff" } } });
});

test("OpenAI responses", () => {
  const payload = { model: "m", input: [], tools: [{ type: "function", name: "handoff", parameters: {} }] };
  assert.deepEqual(forceTool(payload, "handoff"), { ...payload, tool_choice: { type: "function", name: "handoff" } });
});

test("an unknown shape fails with the payload keys", () => {
  assert.throws(() => forceTool({ model: "m", contents: [] }, "handoff"), /cannot force a tool for this provider payload: model, contents$/);
  assert.throws(() => forceTool({ tools: [{ name: "other", input_schema: {} }] }, "handoff"), /payload: tools$/);
  assert.throws(() => forceTool({ tools: [{ foo: "handoff" }] }, "handoff"), /payload: tools$/);
  assert.throws(() => forceTool("x", "handoff"), /payload: string$/);
});
