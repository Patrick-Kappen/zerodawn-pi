import assert from "node:assert/strict";
import { test } from "node:test";
import register from "../index.ts";
import { customPrompt } from "./prompt.ts";

const start = () => {
  let handler: any;
  const on = (name: string, fn: any) => {
    if (name === "before_agent_start") handler = fn;
  };
  register({ on, registerCommand() {} } as any);
  return handler;
};

test("core sets the custom prompt: preamble, workflow and a pointer to the pi docs", () => {
  const options: any = { cwd: "/p" };
  start()({ systemPromptOptions: options });
  assert.match(options.customPrompt, /^You are an expert software developer/);
  assert.match(options.customPrompt, /<workflow>\n- Look wide first\./);
  assert.match(options.customPrompt, /<pi_docs>\nFor a question about pi itself .*README\.md first/);
});

test("core fails loud when another custom prompt is set", () => {
  assert.throws(() => start()({ systemPromptOptions: { customPrompt: "mine" } }), /SYSTEM\.md or --system-prompt sets a custom prompt/);
  const options = { customPrompt: customPrompt() };
  start()({ systemPromptOptions: options });
  assert.equal(options.customPrompt, customPrompt());
});
