import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunResult } from "../../shared/pair.ts";
import register, { registerLsp } from "./index.ts";

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });

function api(reply: () => RunResult = () => ok('{"buf":1,"modified":true,"created":false}')) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const messages: any[] = [];
  let clock = 0;
  const pi = {
    on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
    sendMessage: (message: any) => messages.push(message),
    exec: async (): Promise<RunResult> => reply(),
  };
  const deps = {
    exec: async (): Promise<RunResult> => reply(),
    sleep: async (ms: number) => {
      clock += ms;
    },
    read: () => "same",
    now: () => clock,
  };
  return { pi, handlers, messages, deps };
}

test("without PI_LSP_SERVER nothing is registered and nothing happens", () => {
  const seen: string[] = [];
  register({ on: (name: string) => seen.push(name) } as never);
  assert.deepEqual(seen, []);
  const { pi, handlers } = api();
  registerLsp(pi as never, { ...api().deps, server: undefined });
  assert.equal(handlers.size, 0);
});

test("with a socket it registers the session, settle and tool_result handlers", () => {
  const { pi, handlers } = api();
  registerLsp(pi as never, { ...api().deps, server: "/s.sock", nvim: "nvim" });
  assert.deepEqual([...handlers.keys()].sort(), ["agent_before_settle", "session_shutdown", "session_start", "tool_result"]);
});

test("an edit result starts the check in the background and the settle handler waits for it", async () => {
  const { pi, handlers, messages, deps } = api();
  registerLsp(pi as never, { ...deps, server: "/s.sock", nvim: "nvim" });
  const result = handlers.get("tool_result")?.({ toolName: "edit", isError: false, input: { path: "a.ts" }, toolCallId: "t" }, { cwd: "/w" });
  assert.equal(result, undefined);
  const settle = await handlers.get("agent_before_settle")?.({}, { mode: "print" });
  assert.deepEqual(settle, { continue: true });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].customType, "lsp");
  assert.match(messages[0].content, /unsaved changes in a\.ts/);
});

test("a failed edit, another tool and tui mode do nothing", async () => {
  const { pi, handlers, messages, deps } = api();
  registerLsp(pi as never, { ...deps, server: "/s.sock", nvim: "nvim" });
  handlers.get("tool_result")?.({ toolName: "edit", isError: true, input: { path: "a.ts" }, toolCallId: "t" }, { cwd: "/w" });
  handlers.get("tool_result")?.({ toolName: "bash", isError: false, input: { command: "ls" }, toolCallId: "t" }, { cwd: "/w" });
  assert.equal(await handlers.get("agent_before_settle")?.({}, { mode: "print" }), undefined);
  assert.deepEqual(messages, []);
});
