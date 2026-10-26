type Payload = Record<string, unknown>;

function isObject(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The shape comes from the declared tools, not from the model name. Each API declares a tool differently:
// Anthropic messages:        { name, input_schema }
// OpenAI chat completions:   { type: "function", function: { name, parameters } }
// OpenAI responses:          { type: "function", name, parameters }
// pi declares a tool that becomes active during a session as a "tool_addition" block in the messages
// (Anthropic deferred tools), not in payload.tools.
function addedTools(payload: Payload): unknown[] {
  if (!Array.isArray(payload.messages)) return [];
  return payload.messages.flatMap((message) =>
    isObject(message) && Array.isArray(message.content)
      ? message.content
          .filter((block) => isObject(block) && block.type === "tool_addition" && isObject(block.tool))
          .map((block) => (block.tool as Payload).definition)
      : [],
  );
}

export function forceTool(payload: unknown, name: string): Payload {
  const keys = isObject(payload) ? Object.keys(payload).join(", ") : typeof payload;
  const unknown = new Error(`handoff: cannot force a tool for this provider payload: ${keys}`);
  if (!isObject(payload)) throw unknown;
  const tools = [...(Array.isArray(payload.tools) ? payload.tools : []), ...addedTools(payload)].filter(isObject);
  const copy: Payload = { ...payload };
  if (tools.some((tool) => tool.name === name && "input_schema" in tool)) {
    copy.tool_choice = { type: "tool", name };
    // Anthropic rejects a forced tool together with extended thinking.
    const thinking = copy.thinking;
    if (isObject(thinking) && thinking.type !== "disabled") delete copy.thinking;
    return copy;
  }
  if (tools.some((tool) => isObject(tool.function) && tool.type === "function" && tool.function.name === name)) {
    copy.tool_choice = { type: "function", function: { name } };
    return copy;
  }
  if (tools.some((tool) => tool.type === "function" && tool.name === name && !("function" in tool))) {
    copy.tool_choice = { type: "function", name };
    return copy;
  }
  throw unknown;
}
