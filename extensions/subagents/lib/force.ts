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

type Shape = "anthropic" | "chat" | "responses";

function shapeOf(payload: Payload, names: string[]): Shape | undefined {
  const tools = [...(Array.isArray(payload.tools) ? payload.tools : []), ...addedTools(payload)].filter(isObject);
  const named = (name: unknown) => typeof name === "string" && names.includes(name);
  if (tools.some((tool) => named(tool.name) && "input_schema" in tool)) return "anthropic";
  if (tools.some((tool) => isObject(tool.function) && tool.type === "function" && named(tool.function.name))) return "chat";
  if (tools.some((tool) => tool.type === "function" && named(tool.name) && !("function" in tool))) return "responses";
  return undefined;
}

function unknownShape(label: string, payload: unknown): Error {
  const keys = isObject(payload) ? Object.keys(payload).join(", ") : typeof payload;
  return new Error(`${label}: cannot force a tool for this provider payload: ${keys}`);
}

// Anthropic rejects a forced tool together with extended thinking.
function withoutThinking(copy: Payload): void {
  const thinking = copy.thinking;
  if (isObject(thinking) && thinking.type !== "disabled") delete copy.thinking;
}

export function forceTool(payload: unknown, name: string): Payload {
  if (!isObject(payload)) throw unknownShape(name, payload);
  const shape = shapeOf(payload, [name]);
  const copy: Payload = { ...payload };
  if (shape === "anthropic") {
    copy.tool_choice = { type: "tool", name };
    withoutThinking(copy);
  } else if (shape === "chat") copy.tool_choice = { type: "function", function: { name } };
  else if (shape === "responses") copy.tool_choice = { type: "function", name };
  else throw unknownShape(name, payload);
  return copy;
}

/** The model must call one tool, and may choose which. */
export function forceAnyTool(payload: unknown, names: string[]): Payload {
  if (!isObject(payload)) throw unknownShape(names.join("/"), payload);
  const shape = shapeOf(payload, names);
  const copy: Payload = { ...payload };
  if (shape === "anthropic") {
    copy.tool_choice = { type: "any" };
    withoutThinking(copy);
  } else if (shape === "chat" || shape === "responses") copy.tool_choice = "required";
  else throw unknownShape(names.join("/"), payload);
  return copy;
}
