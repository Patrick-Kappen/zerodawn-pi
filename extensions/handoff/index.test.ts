import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import register, { buildHandoff } from "./index.ts";

const card = { goal: "Ship it", status: "active", decisions: [], open: [], next: "Merge", avoid: [], done: [] };
const root = mkdtempSync(join(tmpdir(), "handoff-cmd-"));
const branch = [
  { id: "e1", type: "message", message: { role: "user", content: "Ship it" } },
  { id: "e2", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
];
const ctx = (seen: unknown[]) =>
  ({
    cwd: root,
    sessionManager: { getSessionFile: () => join(root, "s.jsonl"), getBranch: () => branch },
    modelRegistry: {
      find: () => "m",
      hasConfiguredAuth: () => true,
      complete: async (_m: unknown, context: any) => {
        seen.push(context.messages[0].content);
        return { stopReason: "toolUse", content: [{ type: "toolCall", name: "write_card", arguments: card }] };
      },
    },
    ui: { notify: (text: string) => seen.push(text) },
    waitForIdle: async () => {},
    newSession: async (opts: any) => {
      await opts.withSession({ sendMessage: async (m: any) => seen.push(m) });
      seen.push(opts.parentSession);
      return { cancelled: false };
    },
  }) as any;

test("buildHandoff starts after the previous card and saves the handoff file", async () => {
  const seen: unknown[] = [];
  const first = await buildHandoff(ctx(seen), ["p/m"]);
  assert.match(String(seen[0]), /Previous card:\n\(none\)\n\nTranscript since the previous card:\nuser: Ship it\nassistant: Done\./);
  assert.equal(first.handoff.untilEntry, "e2");
  assert.ok(existsSync(first.path));
  await buildHandoff(ctx(seen), ["p/m"]);
  assert.match(String(seen[1]), /Previous card:\n\{"goal":"Ship it".*\n\nTranscript since the previous card:\n\(nothing new\)/s);
});

test("/handoff starts a new session with the handoff; /handoff card only shows it; other arguments fail", async () => {
  const config = join(root, "config.json");
  writeFileSync(config, JSON.stringify({ handoffModels: ["p/m"] }));
  process.env.ZERODAWN_PI_CONFIG = config;
  let command: any;
  register({ registerCommand: (_n: string, c: any) => (command = c) } as any);
  const seen: any[] = [];
  await assert.rejects(command.handler("later", ctx(seen)), /unknown argument "later"/);
  await command.handler("", ctx(seen));
  const message = seen.find((s) => s?.customType === "handoff");
  assert.match(message.content, /^# Handoff\nGoal: Ship it/);
  assert.equal(seen.at(-1), join(root, "s.jsonl"));
  await command.handler("card", ctx(seen));
  assert.match(String(seen.at(-1)), /^Handoff card by p\/m: .*handoff\/\d+\.json\n\n# Handoff/);
});
