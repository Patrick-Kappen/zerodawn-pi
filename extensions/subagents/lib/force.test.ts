import assert from "node:assert/strict";
import { test } from "node:test";
import { forceAnyTool, forceTool } from "./force.ts";

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

test("OpenAI Codex responses: tools in additional_tools and tool_search_output input items", () => {
  const added = { type: "additional_tools", role: "developer", tools: [{ type: "function", name: "handoff", parameters: {} }] };
  const payload = { model: "m", input: [added], tool_choice: "auto" };
  assert.deepEqual(forceTool(payload, "handoff").tool_choice, { type: "function", name: "handoff" });
  const searched = { type: "tool_search_output", call_id: "c", tools: [{ type: "function", name: "done", parameters: {} }] };
  assert.equal(forceAnyTool({ model: "m", input: [searched] }, CHOICE).tool_choice, "required");
});

test("an unknown shape fails with the payload keys", () => {
  assert.throws(() => forceTool({ model: "m", contents: [] }, "handoff"), /cannot force a tool for this provider payload: model, contents$/);
  assert.throws(() => forceTool({ tools: [{ name: "other", input_schema: {} }] }, "handoff"), /payload: tools$/);
  assert.throws(() => forceTool({ tools: [{ foo: "handoff" }] }, "handoff"), /payload: tools$/);
  assert.throws(() => forceTool("x", "handoff"), /payload: string$/);
});

const CHOICE = ["continue", "done", "ask", "blocker"];

test("forceAnyTool, Anthropic: type any, enabled thinking removed", () => {
  const payload = { tools: [{ name: "done", input_schema: {} }], thinking: { type: "enabled", budget_tokens: 5 } };
  assert.deepEqual(forceAnyTool(payload, CHOICE), { tools: payload.tools, tool_choice: { type: "any" } });
});

test("forceAnyTool, Anthropic: a tool_addition block counts", () => {
  const addition = { type: "tool_addition", tool: { definition: { name: "continue", input_schema: {} } } };
  assert.deepEqual(forceAnyTool({ tools: [], messages: [{ role: "user", content: [addition] }] }, CHOICE).tool_choice, { type: "any" });
});

test("forceAnyTool, OpenAI chat and responses: required", () => {
  const chat = { tools: [{ type: "function", function: { name: "done", parameters: {} } }] };
  assert.deepEqual(forceAnyTool(chat, CHOICE), { ...chat, tool_choice: "required" });
  const responses = { tools: [{ type: "function", name: "ask", parameters: {} }] };
  assert.deepEqual(forceAnyTool(responses, CHOICE), { ...responses, tool_choice: "required" });
});

test("forceAnyTool: an unknown shape fails with the payload keys", () => {
  assert.throws(() => forceAnyTool({ model: "m" }, CHOICE), /continue\/done\/ask\/blocker: cannot force a tool for this provider payload: model$/);
  assert.throws(() => forceAnyTool({ tools: [{ name: "read", input_schema: {} }] }, CHOICE), /payload: tools$/);
  assert.throws(() => forceAnyTool("x", CHOICE), /payload: string$/);
});
