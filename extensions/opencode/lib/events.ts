export type ToolUse = { tool: string; status: string; input: string; error?: string };

export type Run = {
  session?: string;
  text: string[];
  tools: ToolUse[];
  errors: string[];
  tokens: { input: number; output: number; cacheRead: number };
  cost: number;
};

export function emptyRun(): Run {
  return { text: [], tools: [], errors: [], tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 0 };
}

function brief(value: unknown, max = 120): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  const e = error as { data?: { message?: unknown }; message?: unknown; name?: unknown } | undefined;
  const message = e?.data?.message ?? e?.message;
  if (typeof message === "string" && message) return message;
  return JSON.stringify(error);
}

export function applyEvent(run: Run, line: string): void {
  if (!line.trim()) return;
  let event: any;
  try {
    event = JSON.parse(line);
  } catch (err) {
    throw new Error(`opencode: the JSON output has an invalid line: ${brief(line, 200)}`, { cause: err });
  }
  if (typeof event?.sessionID === "string") run.session = event.sessionID;
  const part = event?.part ?? {};
  switch (event?.type) {
    case "text":
      if (typeof part.text === "string" && part.text.trim()) run.text.push(part.text.trim());
      return;
    case "tool_use": {
      const state = part.state ?? {};
      const use: ToolUse = { tool: String(part.tool), status: String(state.status), input: brief(state.input) };
      if (state.status === "error") use.error = brief(state.error ?? state.output, 300);
      run.tools.push(use);
      return;
    }
    case "step_finish": {
      const tokens = part.tokens ?? {};
      run.tokens.input += Number(tokens.input ?? 0);
      run.tokens.output += Number(tokens.output ?? 0);
      run.tokens.cacheRead += Number(tokens.cache?.read ?? 0);
      run.cost += Number(part.cost ?? 0);
      return;
    }
    case "error":
      run.errors.push(errorText(event.error));
      return;
  }
}

/** The error of a finished run, or undefined. An error event names the cause better than the exit code, so it comes first. */
export function runError(run: Run, code: number | null, stderr: string): string | undefined {
  if (run.errors.length) return `${run.errors.join("\n")}\nSession: ${run.session}`;
  if (code !== 0) return `exit ${code}: ${stderr}`;
  if (!run.session) return "the output has no session ID. Check the OpenCode version.";
  if (!run.text.length) return `the agent gave no answer. Session: ${run.session}`;
}

export function report(run: Run): string {
  const lines = [run.text.join("\n\n")];
  if (run.tools.length) {
    lines.push("", "OpenCode tools:");
    for (const use of run.tools) lines.push(`- ${use.tool} ${use.input}${use.error ? ` → ${use.status}: ${use.error}` : ""}`);
  }
  lines.push("", `Session: ${run.session}`);
  return lines.join("\n");
}

export function parseModels(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[\w.-]+\/\S+$/.test(line));
}
