import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import register, { buildHandoff } from "./index.ts";

const card = {
  goal: "Ship it",
  status: "active",
  waitsForUser: true,
  inProgress: [] as string[],
  state: [],
  next: ["Merge"],
  merged: [],
  open: [],
  decisions: [],
  avoid: [],
};
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
  register({ registerCommand: (_n: string, c: any) => (command = c), on() {}, registerTool() {} } as any);
  const seen: any[] = [];
  await assert.rejects(command.handler("later", ctx(seen)), /unknown argument "later"/);
  await command.handler("", ctx(seen));
  const message = seen.find((s) => s?.customType === "handoff");
  assert.match(message.content, /^# Handoff\nGoal: Ship it/);
  assert.equal(seen.at(-1), join(root, "s.jsonl"));
  await command.handler("card", ctx(seen));
  assert.match(String(seen.at(-1)), /^Handoff card by p\/m: .*handoff\/\d+\.json\n\n# Handoff/);
});

test("agent_end updates the card in the background after a commit; /quit and /new update it when something is new", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-events-"));
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ handoffModels: ["p/m"] }));
  process.env.ZERODAWN_PI_CONFIG = config;
  const entries: any[] = [{ id: "u1", type: "message", message: { role: "user", content: "Commit it" } }];
  const notes: string[] = [];
  const own = {
    cwd: dir,
    signal: undefined,
    sessionManager: { getSessionFile: () => join(dir, "s.jsonl"), getBranch: () => entries },
    modelRegistry: ctx([]).modelRegistry,
    ui: { notify: (text: string) => notes.push(text) },
  } as any;
  const handlers = new Map<string, any>();
  register({ registerCommand() {}, registerTool() {}, on: (name: string, fn: any) => handlers.set(name, fn) } as any);

  await handlers.get("agent_end")({}, own);
  assert.deepEqual(notes, []);
  entries.push(
    {
      id: "a1",
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "git commit -qm x" } }] },
    },
    { id: "r1", type: "message", message: { role: "toolResult", toolCallId: "c1", content: "ok" } },
  );
  await handlers.get("agent_end")({}, own);
  await handlers.get("session_shutdown")({ reason: "reload" }, own);
  await handlers.get("session_shutdown")({ reason: "quit" }, own);
  assert.match(notes[0], /^handoff: card updated \(commit\) by p\/m: .*handoff\/1\.json$/);
  assert.equal(notes.length, 1);
  entries.push({ id: "u2", type: "message", message: { role: "user", content: "One more" } });
  await handlers.get("session_shutdown")({ reason: "new" }, own);
  assert.match(notes[1], /^handoff: card updated \(\/new\) by p\/m: .*handoff\/2\.json$/);
});

test("turn_end warns and cuts at the next tool turn; settle cuts and keeps the final answer; the hard limit cuts; warming follows jobs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-decider-"));
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ handoffModels: ["p/m"] }));
  process.env.ZERODAWN_PI_CONFIG = config;
  let tokens = 0;
  const notes: string[] = [];
  const own = {
    cwd: dir,
    sessionManager: { getSessionFile: () => join(dir, "s.jsonl"), getBranch: () => branch },
    modelRegistry: ctx([]).modelRegistry,
    ui: { notify: (text: string) => notes.push(text) },
    getContextUsage: () => ({ tokens }),
  } as any;
  const handlers = new Map<string, any>();
  register({ registerCommand() {}, registerTool() {}, on: (name: string, fn: any) => handlers.set(name, fn) } as any);
  const turnEnd = (tools: boolean) => handlers.get("turn_end")({ toolResults: tools ? [{}] : [], entries: [], continue: false }, own);
  const settle = (event = { entries: [] as any[], continue: false }) => handlers.get("agent_before_settle")(event, own);

  tokens = 131_000;
  assert.match((await turnEnd(true)).entries[0].content, /^System: context 131k of 150k\. After your next tool call/);
  tokens = 133_000;
  const work = await turnEnd(true);
  assert.deepEqual(
    work.entries.map((e: any) => e.customType ?? e.type),
    ["compaction", "handoff-resume"],
  );
  assert.equal(work.entries[0].firstKeptEntryId, null);
  assert.equal(work.continue, true);
  assert.match(notes.at(-1) ?? "", /^handoff: context 133k after the warning, in the middle of the work/);

  tokens = 135_000;
  assert.equal((await turnEnd(true)).entries[0].customType, "handoff-warning");
  assert.equal(await turnEnd(false), undefined, "a final answer after the warning is no cut in the middle of the work");
  const answer = await settle();
  assert.deepEqual(
    answer.entries.map((e: any) => e.type),
    ["compaction"],
  );
  assert.equal(answer.entries[0].firstKeptEntryId, "e2", "the final answer stays visible after the cut");
  assert.match(answer.entries[0].summary, /^# Handoff\nGoal: Ship it/);
  assert.equal(answer.continue, false);
  assert.match(notes.at(-1) ?? "", /^handoff: context 135k at the end of the run after the warning/);
  tokens = 152_000;
  assert.equal((await settle()).continue, false, "a run that ended from 150k waits for the user");
  const followup = { type: "custom_message", customType: "checker-followup", content: "Finish the task.", display: false };
  const checked = await settle({ entries: [followup], continue: true });
  assert.deepEqual(
    checked.entries.map((e: any) => e.customType ?? e.type),
    ["checker-followup", "compaction"],
  );
  assert.equal(checked.continue, true, "a checker follow-up goes on after the cut");

  tokens = 175_000;
  const hard = await turnEnd(false);
  assert.deepEqual(
    hard.entries.map((e: any) => e.type),
    ["compaction", "custom_message"],
  );
  assert.equal(hard.continue, true);

  mkdirSync(join(dir, "s", "jobs"), { recursive: true });
  writeFileSync(join(dir, "s", "jobs", "1.json"), JSON.stringify({ id: "1", command: "just check", bg: true, status: join(dir, "1.status") }));
  tokens = 155_000;
  assert.match((await turnEnd(true)).entries[0].content, /The cut waits until the running bash jobs end\.$/);
  assert.equal(await turnEnd(true), undefined);
  assert.equal(await settle(), undefined);
  tokens = 50_000;
  assert.deepEqual(handlers.get("cache_warming_decision")({}, own), { action: "warm" });
});

test("a cut uses the card of the background update when it covers the same entries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-reuse-"));
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ handoffModels: ["p/m"] }));
  process.env.ZERODAWN_PI_CONFIG = config;
  const entries = [
    { id: "u1", type: "message", message: { role: "user", content: "Commit it" } },
    {
      id: "a1",
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "git commit -qm x" } }] },
    },
    { id: "r1", type: "message", message: { role: "toolResult", toolCallId: "c1", content: "ok" } },
  ];
  const calls: unknown[] = [];
  const own = {
    cwd: dir,
    sessionManager: { getSessionFile: () => join(dir, "s.jsonl"), getBranch: () => entries },
    modelRegistry: ctx(calls).modelRegistry,
    ui: { notify() {} },
    getContextUsage: () => ({ tokens: 155_000 }),
  } as any;
  const handlers = new Map<string, any>();
  register({ registerCommand() {}, registerTool() {}, on: (name: string, fn: any) => handlers.set(name, fn) } as any);
  handlers.get("agent_end")({}, own);
  const cut = await handlers.get("agent_before_settle")({ entries: [], continue: false }, own);
  assert.equal(calls.length, 1);
  assert.equal(cut.entries[0].firstKeptEntryId, "a1");
});

test("recall answers from the session file with entry ids, and names a missing session file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-recall-"));
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ handoffModels: ["p/m"] }));
  process.env.ZERODAWN_PI_CONFIG = config;
  const session = join(dir, "old.jsonl");
  writeFileSync(
    session,
    [
      { type: "session", id: "h" },
      { type: "message", id: "e1", message: { role: "user", content: "Why out:<name>?" } },
      { type: "message", id: "e2", message: { role: "assistant", content: [{ type: "text", text: "It covers every output, not only bash jobs." }] } },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  );
  let tool: any;
  register({ registerCommand() {}, on() {}, registerTool: (t: any) => (tool = t) } as any);
  let asked = "";
  const own = {
    sessionManager: { getSessionFile: () => undefined },
    modelRegistry: {
      find: () => "m",
      hasConfiguredAuth: () => true,
      complete: async (_m: unknown, c: any) => {
        asked = c.messages[0].content;
        return { stopReason: "stop", content: [{ type: "text", text: "Covers every output [e2]." }] };
      },
    },
  } as any;
  const result = await tool.execute("id", { question: "Why out:<name>?", session }, undefined, undefined, own);
  assert.equal(result.content[0].text, "Covers every output [e2].");
  assert.match(asked, /^Question: Why out:<name>\?\n\nTranscript:\n\[e1\] user: Why out:<name>\?\n\[e2\] assistant: It covers every output/);
  await assert.rejects(tool.execute("id", { question: "x" }, undefined, undefined, own), /has no session file/);
});
