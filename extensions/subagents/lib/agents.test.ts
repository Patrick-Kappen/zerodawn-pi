import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgents, MAX_EVENTS } from "./agents.ts";
import type { Timers } from "./lifecycle.ts";
import type { ServerMessage } from "./protocol.ts";

function fakeClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    setTimeout(callback, ms) {
      const handle = next++;
      pending.set(handle, { at: now + ms, callback });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  async function advance(ms: number): Promise<void> {
    const end = now + ms;
    for (;;) {
      const due = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = end;
  }
  return { timers, advance, pending };
}

function setup(options: { openFails?: boolean } = {}) {
  const clock = fakeClock();
  const opened: { name: string; command: string[]; env: Record<string, string> | undefined }[] = [];
  const toSub: [string, ServerMessage][] = [];
  const toMains: ServerMessage[] = [];
  const errors: Error[] = [];
  let changes = 0;
  let windows: { id: string; name: string }[] = [];
  let n = 0;
  const agents = createAgents({
    session: "pi-sub-abcd1234",
    dir: "/tmp/pi-sub-abcd1234",
    socket: "/run/s.sock",
    piCommand: "pi",
    extensions: ["/x/index.ts", "/y/login.ts"],
    tmux: {
      openWindow: async (_session, name, command, env) => {
        if (options.openFails) throw new Error("tmux down");
        opened.push({ name, command, env });
        const id = `@${++n}`;
        windows.push({ id, name });
        return id;
      },
      listWindows: async () => windows,
    },
    timers: clock.timers,
    newId: () => "abcdef12-0000-4000-8000-000000000000",
    sendToSub: (id, message) => toSub.push([id, message]),
    sendToMains: (message) => toMains.push(message),
    onChange: () => changes++,
    onError: (error) => errors.push(error),
  });
  return { agents, clock, opened, toSub, toMains, errors, changes: () => changes, setWindows: (list: typeof windows) => (windows = list) };
}

const ID = "abcdef12-0000-4000-8000-000000000000";
const ARGS = ["--no-tools", "--no-mcp", "--model", "m/x:off", "--system-prompt", "You are a test."];
const usage = { tokens: 10, cost: 0.5 };

test("start opens a window with the pi command, the env and a starting entry", async () => {
  const { agents, opened } = setup();
  assert.equal(await agents.start("do it", ARGS, []), ID);
  assert.deepEqual(opened, [
    {
      name: "sub-abcd",
      command: [
        "pi",
        "-ne",
        "-ns",
        "-np",
        "-nc",
        "--no-themes",
        "-e",
        "/x/index.ts",
        "-e",
        "/y/login.ts",
        ...ARGS,
        "--session-id",
        ID,
        "--session-dir",
        "/tmp/pi-sub-abcd1234/sessions",
      ],
      env: { PI_SUBAGENT_SOCKET: "/run/s.sock", PI_SUBAGENT_ID: ID, PI_SUBAGENT_CHECKS: "[]" },
    },
  ]);
  assert.deepEqual(agents.entries(), [{ id: ID, role: "sub", window: "@1", status: "starting" }]);
  assert.equal(agents.running(), true);
});

test("a failed window start leaves no entry and names the cause", async () => {
  const { agents } = setup({ openFails: true });
  await assert.rejects(
    agents.start("t", ARGS, []),
    (error: Error) => /could not start subagent/.test(error.message) && /tmux down/.test((error.cause as Error).message),
  );
  assert.deepEqual(agents.entries(), []);
  assert.equal(agents.running(), false);
});

test("hello sends the task and sets running; settle sets idle and sends one result", async () => {
  const { agents, toSub, toMains } = setup();
  await agents.start("do it", ARGS, []);
  agents.hello(ID);
  assert.deepEqual(toSub, [[ID, { type: "task", task: "do it" }]]);
  assert.equal(agents.entries()[0]?.status, "running");
  agents.event(ID, { kind: "tool_start", name: "bash", args: "{}" });
  agents.event(ID, { kind: "message", text: "m", usage });
  agents.event(ID, { kind: "message", text: "n", usage });
  agents.event(ID, { kind: "settled", text: "final" });
  assert.equal(agents.entries()[0]?.status, "idle");
  assert.equal(agents.running(), false);
  assert.deepEqual(toMains, [
    {
      type: "result",
      id: ID,
      status: "idle",
      text: "final",
      usage: { tokens: 20, cost: 1 },
      events: ["tool bash {}", "message m", "message n", "settled final"],
    },
  ]);
});

test("ask then settle gives status question with the text, then clears it", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  agents.pending(ID, "question", "which db?");
  assert.equal(agents.entries()[0]?.status, "running");
  agents.event(ID, { kind: "settled", text: "final text" });
  assert.equal(agents.entries()[0]?.status, "question");
  assert.equal(agents.running(), false);
  assert.deepEqual(
    toMains.map((message) => message.type === "result" && [message.status, message.text]),
    [["question", "which db?"]],
  );
  agents.answer(ID, "sqlite");
  agents.event(ID, { kind: "settled", text: "done" });
  assert.deepEqual(toMains.map((message) => message.type === "result" && [message.status, message.text]).at(-1), ["idle", "done"]);
});

test("blocker then settle gives status blocked", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  agents.pending(ID, "blocked", "no access");
  agents.event(ID, { kind: "settled", text: "x" });
  assert.equal(agents.entries()[0]?.status, "blocked");
  assert.deepEqual(
    toMains.map((message) => message.type === "result" && [message.status, message.text]),
    [["blocked", "no access"]],
  );
});

test("an error event fails the agent with its text", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  agents.event(ID, { kind: "error", text: "done gate failed in the subagent: boom" });
  assert.equal(agents.entries()[0]?.status, "failed");
  assert.deepEqual(
    toMains.map((message) => message.type === "result" && [message.status, message.text]),
    [["failed", "done gate failed in the subagent: boom"]],
  );
});

test("answer sends the text as a task and sets running, from idle, question and blocked", async () => {
  const { agents, toSub } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  agents.event(ID, { kind: "settled", text: "x" });
  agents.answer(ID, "more");
  assert.deepEqual(toSub.at(-1), [ID, { type: "task", task: "more" }]);
  assert.equal(agents.entries()[0]?.status, "running");
  assert.equal(agents.running(), true);
  agents.pending(ID, "blocked", "r");
  agents.event(ID, { kind: "settled", text: "x" });
  agents.answer(ID, "fixed");
  assert.equal(agents.entries()[0]?.status, "running");
});

test("answer and pending errors: unknown id, wrong status, empty text", async () => {
  const { agents } = setup();
  await agents.start("t", ARGS, []);
  assert.throws(() => agents.answer(ID, "x"), /status "starting"/);
  agents.hello(ID);
  assert.throws(() => agents.answer(ID, "x"), /status "running"/);
  assert.throws(() => agents.answer("nope", "x"), /no subagent/);
  assert.throws(() => agents.answer(ID, "  "), /non-empty/);
  assert.throws(() => agents.pending("nope", "question", "q"), /no subagent/);
  agents.event(ID, { kind: "settled", text: "x" });
  assert.throws(() => agents.pending(ID, "question", "q"), /status "idle"/);
});

test("only the last 20 events are kept, each at most 200 characters", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  for (let i = 0; i < 30; i++) agents.event(ID, { kind: "tool_start", name: `t${i}`, args: "a".repeat(500) });
  agents.event(ID, { kind: "settled", text: "x" });
  const result = toMains[0];
  assert.ok(result?.type === "result");
  assert.equal(result.events.length, MAX_EVENTS);
  assert.ok(result.events.every((event) => event.length <= 200));
  assert.match(result.events[0] ?? "", /^tool t11 /);
});

test("no hello within 30 s fails the agent and tells main", async () => {
  const { agents, clock, toMains } = setup();
  await agents.start("t", ARGS, []);
  await clock.advance(29_000);
  assert.equal(agents.entries()[0]?.status, "starting");
  await clock.advance(1000);
  assert.equal(agents.entries()[0]?.status, "failed");
  assert.deepEqual(toMains, [
    {
      type: "result",
      id: ID,
      status: "failed",
      text: `subagent ${ID} did not connect; run tmux attach -t pi-sub-abcd1234`,
      usage: { tokens: 0, cost: 0 },
      events: [],
    },
  ]);
});

test("a hello cancels the hello timeout", async () => {
  const { agents, clock, toMains } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  await clock.advance(60_000);
  assert.equal(agents.entries()[0]?.status, "running");
  assert.deepEqual(toMains, []);
});

test("a window that is gone without a settle fails the agent at the next check", async () => {
  const { agents, clock, toMains, setWindows, errors } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  await clock.advance(2000);
  assert.equal(agents.entries()[0]?.status, "running");
  setWindows([]);
  await clock.advance(2000);
  assert.equal(agents.entries()[0]?.status, "failed");
  const result = toMains[0];
  assert.ok(result?.type === "result" && result.status === "failed");
  assert.match(result.text, /window @1 is gone.*tmux attach -t pi-sub-abcd1234/);
  assert.deepEqual(errors, []);
  assert.equal(clock.pending.size, 0);
});

test("a settled agent whose window is gone stays idle", async () => {
  const { agents, clock, setWindows } = setup();
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  agents.event(ID, { kind: "settled", text: "x" });
  setWindows([]);
  await clock.advance(10_000);
  assert.equal(agents.entries()[0]?.status, "idle");
});

test("late events of a failed agent are ignored; a second settle does not send a second result", async () => {
  const { agents, clock, toMains } = setup();
  await agents.start("t", ARGS, []);
  await clock.advance(30_000);
  agents.event(ID, { kind: "message", text: "late", usage });
  assert.equal(toMains.length, 1);
  const second = setup();
  await second.agents.start("t", ARGS, []);
  second.agents.hello(ID);
  second.agents.event(ID, { kind: "settled", text: "a" });
  second.agents.event(ID, { kind: "settled", text: "b" });
  assert.equal(second.toMains.length, 1);
});

test("hello and events of an unknown agent fail loud; a second hello fails", async () => {
  const { agents } = setup();
  assert.throws(() => agents.hello("nope"), /no subagent with id "nope"/);
  assert.throws(() => agents.event("nope", { kind: "settled", text: "" }), /no subagent/);
  await agents.start("t", ARGS, []);
  agents.hello(ID);
  assert.throws(() => agents.hello(ID), /cannot say hello again/);
});

test("a listWindows error goes to onError", async () => {
  const clock = fakeClock();
  const errors: Error[] = [];
  const agents = createAgents({
    session: "pi-sub-abcd1234",
    dir: "/d",
    socket: "/s",
    piCommand: "pi",
    extensions: ["/x"],
    tmux: {
      openWindow: async () => "@1",
      listWindows: async () => {
        throw new Error("list broke");
      },
    },
    timers: clock.timers,
    newId: () => ID,
    sendToSub: () => {},
    sendToMains: () => {},
    onChange: () => {},
    onError: (error) => errors.push(error),
  });
  await agents.start("t", ARGS, []);
  await clock.advance(2000);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? "", /could not list the windows/);
  assert.match(String(errors[0]?.cause), /list broke/);
});

test("dispose clears every timer", async () => {
  const { agents, clock } = setup();
  await agents.start("t", ARGS, []);
  assert.ok(clock.pending.size > 0);
  agents.dispose();
  assert.equal(clock.pending.size, 0);
});
