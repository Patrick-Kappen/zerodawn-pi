import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "./index.ts";
import { findBufferExpr } from "./lib/run.ts";

function setup(exec: (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>) {
  const handlers = new Map<string, (event: any, ctx?: any) => any>();
  const messages: { text: string; options: any }[] = [];
  let resolveMessage: (text: string) => void = () => {};
  const received = new Promise<string>((resolve) => {
    resolveMessage = resolve;
  });
  const executed: { command: string; args: string[] }[] = [];
  const pi = {
    on: (name: string, fn: any) => handlers.set(name, fn),
    sendMessage: (message: any, options: any) => {
      messages.push({ text: message.content, options });
      resolveMessage(message.content);
    },
    exec: async (command: string, args: string[]) => {
      executed.push({ command, args });
      return exec(command, args);
    },
  };
  extension(pi as any);
  return { executed, handlers, messages, received };
}

const ctx = (notices: string[]) => ({
  cwd: "/w",
  ui: { notify: (text: string, level: string) => notices.push(`${level}: ${text}`) },
});

test("without PI_NVIM_SERVER, session start notifies once and edits run no check", async () => {
  const saved = process.env.PI_NVIM_SERVER;
  delete process.env.PI_NVIM_SERVER;
  try {
    const notices: string[] = [];
    const { executed, handlers } = setup(async () => ({ code: 0, stdout: "", stderr: "" }));
    await handlers.get("session_start")?.({}, ctx(notices));
    assert.deepEqual(notices, ["warning: lsp: PI_NVIM_SERVER is not set; LSP checks are off."]);
    handlers.get("tool_result")?.({ toolName: "edit", isError: false, input: { path: "a.ts" } }, ctx(notices));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(executed, []);
  } finally {
    if (saved === undefined) delete process.env.PI_NVIM_SERVER;
    else process.env.PI_NVIM_SERVER = saved;
  }
});

test("after an edit, the conflict goes to the agent as a steer message that starts a turn", async () => {
  const saved = process.env.PI_NVIM_SERVER;
  process.env.PI_NVIM_SERVER = "/dev/null";
  try {
    const notices: string[] = [];
    const { handlers, messages, received } = setup(async (command, args) => {
      if (command !== "nvim") return { code: 1, stdout: "", stderr: "unexpected" };
      if (args.at(-1) === findBufferExpr("/w/a.ts"))
        return { code: 0, stdout: JSON.stringify({ buf: 1, created: false, modified: true, clients: 0 }), stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected" };
    });
    await handlers.get("session_start")?.({}, ctx(notices));
    assert.deepEqual(notices, []);
    handlers.get("tool_result")?.({ toolName: "edit", isError: false, input: { path: "a.ts" } }, ctx(notices));
    const text = await Promise.race([received, new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 2000))]);
    assert.equal(text, "/w/a.ts has unsaved changes in nvim; LSP check skipped");
    assert.deepEqual(messages[0].options, { triggerTurn: true, deliverAs: "steer" });
  } finally {
    if (saved === undefined) delete process.env.PI_NVIM_SERVER;
    else process.env.PI_NVIM_SERVER = saved;
  }
});
