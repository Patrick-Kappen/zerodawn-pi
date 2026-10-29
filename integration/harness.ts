import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";

/**
 * A fake ExtensionAPI that runs real extensions with pi's handler rules.
 *
 * The rules come from the pi extension runner:
 * - tool_call: dist/core/extensions/runner.js:957-973 (emitToolCall) — the handlers run in load order,
 *   they get the same event object, a change of event.input stays, and the first `block: true` ends the call.
 * - tool_result: dist/core/extensions/runner.js:900-953 (emitToolResult) — one event object for all handlers;
 *   content, details and isError that a handler returns are what the next handler sees.
 * - agent_before_settle: dist/core/extensions/runner.js:759-806 (emitBoundary) — each handler gets
 *   `{ ...baseEvent, entries, continue }` with the entries and the continue decision of the handlers before it.
 * - other events: dist/core/extensions/runner.js:813-840 (emit) — the same event object, the last defined result wins.
 * - load order: pi loads `extensions/*\/index.ts` in glob order (scripts/dev.sh passes the shell glob to `pi -e`);
 *   extensionLoadOrder() gives that order, so a test can pass its subset in the real order.
 */

export type Handler = (event: any, ctx?: any) => unknown;
export type Extension = { name: string; register: (pi: any) => void };

export type HarnessOptions = {
  /** Working directory of the context, and the place of the session directory. */
  root: string;
  /** ctx.mode: "tui" (default), "print" or "json". */
  mode?: string;
  extensions: Extension[];
  /** ctx.modelRegistry; a test gives fixed answers, so no model is called. */
  modelRegistry?: Record<string, unknown>;
};

/** The extension directories of "extensions/*\/index.ts" in load order. */
export function extensionLoadOrder(): string[] {
  return readdirSync(fileURLToPath(new URL("../extensions", import.meta.url))).sort();
}

/** Polls until check() is true; the test fails when it stays false. */
export async function waitFor(check: () => boolean, what: string, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await delay(10);
  }
  throw new Error(`${what} did not happen within ${timeout} ms`);
}

export type Harness = ReturnType<typeof createHarness>;

export function createHarness(options: HarnessOptions) {
  const { root } = options;
  const handlers = new Map<string, { owner: string; handler: Handler }[]>();
  const tools = new Map<string, any>();
  const messages: any[] = [];
  const notes: string[] = [];
  const events = createEventBus();
  let branch: any[] = [];
  let sessionFile = join(root, "session.jsonl");
  let tokens: number | undefined;

  const api = {
    events,
    appendEntry() {},
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), { owner: current, handler }]);
      return () => {};
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerShortcut() {},
    registerCommand() {},
    registerToolRenderer() {},
    registerMessageRenderer() {},
    registerEntryRenderer() {},
    sendMessage(message: any) {
      messages.push(message);
    },
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  } as any;

  const ctx: any = {
    cwd: root,
    mode: options.mode ?? "tui",
    hasUI: true,
    signal: undefined,
    ui: {
      theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
      notify: (text: string, level?: string) => notes.push(`${level ?? "info"}: ${text}`),
      setStatus() {},
      setWidget() {},
      select: async () => undefined,
    },
    // The session manager of pi: the branch that the handlers read, and the file that gives the session directory.
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => "extension-links",
      getBranch: () => branch,
    },
    modelRegistry: options.modelRegistry ?? {},
    isIdle: () => true,
    getContextUsage: () => (tokens === undefined ? undefined : { tokens }),
  };

  let current = "";
  for (const ext of options.extensions) {
    current = ext.name;
    ext.register(api);
  }
  current = "";

  /** The extensions that registered handlers for an event, in load order. */
  const owners = (name: string) => (handlers.get(name) ?? []).map((h) => h.owner);

  async function toolCall(toolName: string, toolCallId: string, input: Record<string, unknown>) {
    let result: any;
    for (const { handler } of handlers.get("tool_call") ?? []) {
      const returned = await handler({ type: "tool_call", toolName, toolCallId, input }, ctx);
      if (!returned) continue;
      result = returned;
      if (result.block) break;
    }
    return { block: result?.block === true, reason: result?.reason as string | undefined, input };
  }

  async function toolResult(toolName: string, toolCallId: string, input: Record<string, unknown>, content: any[], isError = false) {
    const event: any = { type: "tool_result", toolName, toolCallId, input, content, details: undefined, isError };
    let modified = false;
    for (const { handler } of handlers.get("tool_result") ?? []) {
      const returned: any = await handler(event, ctx);
      if (!returned) continue;
      if (returned.content !== undefined) {
        event.content = returned.content;
        modified = true;
      }
      if (returned.details !== undefined) {
        event.details = returned.details;
        modified = true;
      }
      if (returned.isError !== undefined) {
        event.isError = returned.isError;
        modified = true;
      }
    }
    return modified ? { content: event.content, details: event.details, isError: event.isError } : undefined;
  }

  async function settle(entries: any[] = [], shouldContinue = false) {
    let seen = entries;
    let cont = shouldContinue;
    for (const { handler } of handlers.get("agent_before_settle") ?? []) {
      const returned: any = await handler({ type: "agent_before_settle", outcome: "completed", entries: seen, continue: cont }, ctx);
      if (returned?.entries !== undefined) seen = returned.entries;
      if (returned?.continue !== undefined) cont = returned.continue;
    }
    return { entries: seen, continue: cont };
  }

  async function emit(event: any) {
    let result: any;
    for (const { handler } of handlers.get(event.type) ?? []) {
      const returned = await handler(event, ctx);
      if (returned !== undefined) result = returned;
    }
    return result;
  }

  const sessionDir = () => sessionFile.replace(/\.jsonl$/, "");

  return {
    api,
    ctx,
    events,
    tools,
    messages,
    notes,
    owners,
    toolCall,
    toolResult,
    settle,
    emit,
    sessionDir,
    setTokens: (value: number | undefined) => {
      tokens = value;
    },
    setBranch: (entries: any[]) => {
      branch = entries;
    },
    setSessionFile: (file: string) => {
      sessionFile = file;
    },
    /** Stops the timers and the background jobs of the extensions, then removes the fixture. */
    close: async () => {
      await emit({ type: "session_shutdown", reason: "quit" });
      events.clear();
      await delay(100);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
