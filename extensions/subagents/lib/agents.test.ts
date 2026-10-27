import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgents, MAX_EVENTS, MAX_TOKENS } from "./agents.ts";
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
  return { timers, advance, pending, now: () => now };
}

const SOURCE = { repo: "/r/proj", sha: "a".repeat(40) };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeGit(dirty: boolean, log: string[]) {
  return {
    addWorktree: async (spec: { path: string; branch: string; sha: string }) => void log.push(`add ${spec.path} ${spec.branch} ${spec.sha}`),
    state: async () => ({ dirty, moved: false }),
    removeWorktree: async (_repo: string, path: string, branch: string) => void log.push(`remove ${path} ${branch}`),
    changed: async () => ["M a.ts", "?? b.ts"],
  };
}

function setup(options: { openFails?: boolean; dirty?: boolean; failOpenAt?: number } = {}) {
  const gitLog: string[] = [];
  const clock = fakeClock();
  const opened: { name: string; command: string[]; env: Record<string, string> | undefined }[] = [];
  const toSub: [string, ServerMessage][] = [];
  const toMains: ServerMessage[] = [];
  const errors: Error[] = [];
  let changes = 0;
  let windows: { id: string; name: string }[] = [];
  const killed: string[] = [];
  let n = 0;
  const agents = createAgents({
    session: "pi-sub-abcd1234",
    dir: "/tmp/pi-sub-abcd1234",
    socket: "/run/s.sock",
    piCommand: "pi",
    home: "/h",
    git: fakeGit(options.dirty ?? false, gitLog),
    extensions: ["/x/index.ts", "/y/login.ts"],
    tmux: {
      openWindow: async (_session, name, command, env) => {
        if (options.openFails || n + 1 === options.failOpenAt) throw new Error("tmux down");
        opened.push({ name, command, env });
        const id = `@${++n}`;
        windows.push({ id, name });
        return id;
      },
      listWindows: async () => windows,
      killWindow: async (window) => void killed.push(window),
    },
    timers: clock.timers,
    now: () => clock.now(),
    newId: () => "abcdef12-0000-4000-8000-000000000000",
    sendToSub: (id, message) => toSub.push([id, message]),
    sendToMains: (message) => toMains.push(message),
    onChange: () => changes++,
    onError: (error) => errors.push(error),
  });
  return { agents, killed, gitLog, clock, opened, toSub, toMains, errors, changes: () => changes, setWindows: (list: typeof windows) => (windows = list) };
}

const ID = "abcdef12-0000-4000-8000-000000000000";
const MODELS = ["m/x:off", "m/y:low", "m/z"];
const ARGS = ["--no-tools", "--no-mcp", "--system-prompt", "You are a test."];
const usage = { tokens: 10, cost: 0.5 };
const SCOUT = {
  subject: "scope: what",
  summary: "s",
  change: "fix" as const,
  changes: [],
  tests: [],
  findings: ["a.ts:1 x"],
  decisions: [],
  open: [],
  next: "",
  risks: [],
};
const GATE = { ok: true as const, files: [], tests: "not run: no changed files" };
const HANDOFF = { ...SCOUT, summary: "partly", findings: [], changes: [{ file: "f.ts", what: "w" }], open: ["c"], next: "d", risks: ["r"] };

test("usage at the token limit asks for a handoff once; the handoff data gives status handoff", async () => {
  const { agents, toSub, toMains } = setup();
  await agents.start("do it", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  toMains.length = 0;
  agents.event(ID, { kind: "message", text: "a", usage: { tokens: MAX_TOKENS - 1, cost: 1 } });
  assert.deepEqual(toSub, [[ID, { type: "task", task: "do it" }]]);
  assert.equal(toMains.length, 0);
  agents.event(ID, { kind: "message", text: "b", usage: { tokens: 1, cost: 1 } });
  agents.event(ID, { kind: "message", text: "c", usage: { tokens: 5, cost: 1 } });
  assert.deepEqual(toSub.slice(1), [[ID, { type: "handoff" }]]);
  assert.equal(toMains.length, 0);
  await agents.handoff(ID, HANDOFF, undefined, undefined, undefined);
  assert.equal(agents.entries()[0]?.status, "handoff");
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.equal(message.status, "handoff");
  assert.equal(message.text, "partly\nf.ts: w\nopen: c\nnext: d\nrisks: r");
  assert.deepEqual(message.handoff, HANDOFF);
  assert.equal(message.reason, undefined);
  assert.throws(() => agents.answer(ID, "go on"), /status "handoff"/);
  assert.throws(() => agents.handoff(ID, HANDOFF, undefined, undefined, undefined), /status "handoff" and cannot send a handoff/);
});

test("a handoff with a gate reason has the reason line and the reason in the result", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await agents.handoff(ID, HANDOFF, "tests red", undefined, undefined);
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.equal(message.status, "handoff");
  assert.equal(message.text.split("\n")[2], "gate red: tests red");
  assert.equal(message.reason, "tests red");
});

test("start opens a window with the pi command, the env and a starting entry", async () => {
  const { agents, opened } = setup();
  assert.equal(await agents.start("do it", ARGS, [], MODELS, SOURCE), ID);
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
        "--model",
        "m/x:off",
        "--session-id",
        ID,
        "--session-dir",
        "/tmp/pi-sub-abcd1234/sessions",
      ],
      env: { PI_SUBAGENT_SOCKET: "/run/s.sock", PI_SUBAGENT_ID: ID, PI_SUBAGENT_CHECKS: "[]" },
    },
  ]);
  assert.deepEqual(agents.entries(), [
    { id: ID, role: "sub", window: "@1", status: "starting", base: SOURCE.sha, worktree: `/h/.worktrees/proj/sub-abcdef12`, branch: "sub/abcdef12" },
  ]);
  assert.equal(agents.running(), true);
});

test("a failed window start leaves no entry and names the cause", async () => {
  const { agents } = setup({ openFails: true });
  await assert.rejects(
    agents.start("t", ARGS, [], MODELS, SOURCE),
    (error: Error) => /could not start subagent/.test(error.message) && /tmux down/.test((error.cause as Error).message),
  );
  assert.deepEqual(agents.entries(), []);
  assert.equal(agents.running(), false);
});

test("hello sends the task and sets running; settle sets idle and sends one result", async () => {
  const { agents, toSub, toMains } = setup();
  await agents.start("do it", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  assert.deepEqual(toSub, [[ID, { type: "task", task: "do it" }]]);
  assert.equal(agents.entries()[0]?.status, "running");
  agents.event(ID, { kind: "tool_start", name: "bash", args: "{}" });
  agents.event(ID, { kind: "message", text: "m", usage });
  agents.event(ID, { kind: "message", text: "n", usage });
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  assert.equal(agents.entries()[0]?.status, "idle");
  assert.equal(agents.running(), false);
  assert.deepEqual(toMains, [
    {
      type: "result",
      id: ID,
      status: "idle",
      text: "s\na.ts:1 x\ntests: not run: no changed files",
      usage: { tokens: 20, cost: 1 },
      events: ["tool bash {}", "message m", "message n"],
      model: "m/x:off",
      handoff: SCOUT,
      gate: GATE,
    },
  ]);
});

test("a handoff with a gate gives status idle with the text, the data and the gate; a second handoff fails", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  const data = { ...SCOUT, changes: [{ file: "a.ts", what: "w" }], tests: [{ file: "a.test.ts", covers: "c" }], findings: [], open: ["o"] };
  const gate = { ok: true as const, files: ["a.ts", "a.test.ts"], tests: "green: 2 pass, 0 fail" };
  agents.pending(ID, "question", "q");
  await agents.handoff(ID, data, undefined, gate, undefined);
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.equal(message.status, "idle");
  assert.equal(message.text, "s\na.ts: w\ntests: green: 2 pass, 0 fail; added: a.test.ts\nopen: o");
  assert.deepEqual([message.handoff, message.gate, message.reason], [data, gate, undefined]);
  assert.throws(() => agents.handoff(ID, data, undefined, gate, undefined), /status "idle" and cannot send a handoff/);
});

test("a settle without a handoff, a question or a blocker fails the agent", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  agents.event(ID, { kind: "settled", text: "" });
  await flush();
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.equal(message.status, "failed");
  assert.match(message.text, /settled without a handoff/);
});

test("ask then settle gives status question with the text, then clears it", async () => {
  const { agents, toMains } = setup({ dirty: true });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
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
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  assert.deepEqual(toMains.map((message) => message.type === "result" && [message.status, message.text]).at(-1), [
    "idle",
    "s\na.ts:1 x\ntests: not run: no changed files",
  ]);
});

test("blocker then settle gives status blocked", async () => {
  const { agents, toMains } = setup({ dirty: true });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  const blocker = { issue: "no access", files: ["a"], tried: ["b"] };
  agents.pending(ID, "blocked", "no access\nfiles: a\ntried: b", blocker);
  agents.event(ID, { kind: "settled", text: "x" });
  assert.equal(agents.entries()[0]?.status, "blocked");
  assert.deepEqual(
    toMains.map((message) => message.type === "result" && [message.status, message.text, message.blocker]),
    [["blocked", "no access\nfiles: a\ntried: b", blocker]],
  );
  agents.answer(ID, "use the key");
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  const last = toMains.at(-1);
  assert.ok(last?.type === "result");
  assert.equal(last.blocker, undefined);
});

test("an error event fails the agent with its text", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  agents.event(ID, { kind: "error", text: "done gate failed in the subagent: boom" });
  await flush();
  assert.equal(agents.entries()[0]?.status, "failed");
  assert.deepEqual(
    toMains.map((message) => message.type === "result" && [message.status, message.text]),
    [["failed", "done gate failed in the subagent: boom"]],
  );
});

test("answer sends the text as a task and sets running, from idle, question and blocked", async () => {
  const { agents, toSub } = setup({ dirty: true });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
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
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  assert.throws(() => agents.answer(ID, "x"), /status "starting"/);
  agents.hello(ID);
  assert.throws(() => agents.answer(ID, "x"), /status "running"/);
  assert.throws(() => agents.answer("nope", "x"), /no subagent/);
  assert.throws(() => agents.answer(ID, "  "), /non-empty/);
  assert.throws(() => agents.pending("nope", "question", "q"), /no subagent/);
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  assert.throws(() => agents.pending(ID, "question", "q"), /status "idle"/);
});

test("only the last 20 events are kept, each at most 200 characters", async () => {
  const { agents, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  for (let i = 0; i < 30; i++) agents.event(ID, { kind: "tool_start", name: `t${i}`, args: "a".repeat(500) });
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  const result = toMains[0];
  assert.ok(result?.type === "result");
  assert.equal(result.events.length, MAX_EVENTS);
  assert.ok(result.events.every((event) => event.length <= 200));
  assert.match(result.events[0] ?? "", /^tool t10 /);
});

test("no hello within 30 s fails the agent and tells main", async () => {
  const { agents, clock, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
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
      model: "m/x:off",
    },
  ]);
});

test("a hello cancels the hello timeout", async () => {
  const { agents, clock, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await clock.advance(60_000);
  assert.equal(agents.entries()[0]?.status, "running");
  assert.deepEqual(toMains, []);
});

test("a window that is gone without a settle fails the agent at the next check", async () => {
  const { agents, clock, toMains, setWindows, errors } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await clock.advance(2000);
  assert.equal(agents.entries()[0]?.status, "running");
  setWindows([]);
  await clock.advance(2000);
  await flush();
  assert.equal(agents.entries()[0]?.status, "failed");
  const result = toMains[0];
  assert.ok(result?.type === "result" && result.status === "failed");
  assert.match(result.text, /window @1 is gone.*tmux attach -t pi-sub-abcd1234/);
  assert.deepEqual(errors, []);
  agents.dispose();
  assert.equal(clock.pending.size, 0);
});

test("a settled agent whose window is gone stays idle", async () => {
  const { agents, clock, setWindows } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  setWindows([]);
  await clock.advance(10_000);
  assert.equal(agents.entries()[0]?.status, "idle");
});

test("late events of a failed agent are ignored; a second settle does not send a second result", async () => {
  const { agents, clock, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  await clock.advance(30_000);
  agents.event(ID, { kind: "message", text: "late", usage });
  assert.equal(toMains.length, 1);
  const second = setup();
  await second.agents.start("t", ARGS, [], MODELS, SOURCE);
  second.agents.hello(ID);
  await second.agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  second.agents.event(ID, { kind: "settled", text: "b" });
  assert.equal(second.toMains.length, 1);
});

test("hello and events of an unknown agent fail loud; a second hello fails", async () => {
  const { agents } = setup();
  assert.throws(() => agents.hello("nope"), /no subagent with id "nope"/);
  assert.throws(() => agents.event("nope", { kind: "settled", text: "" }), /no subagent/);
  await agents.start("t", ARGS, [], MODELS, SOURCE);
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
    home: "/h",
    git: fakeGit(false, []),
    extensions: ["/x"],
    tmux: {
      openWindow: async () => "@1",
      killWindow: async () => {},
      listWindows: async () => {
        throw new Error("list broke");
      },
    },
    timers: clock.timers,
    now: () => clock.now(),
    newId: () => ID,
    sendToSub: () => {},
    sendToMains: () => {},
    onChange: () => {},
    onError: (error) => errors.push(error),
  });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  await clock.advance(2000);
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? "", /could not list the windows/);
  assert.match(String(errors[0]?.cause), /list broke/);
});

test("dispose clears every timer", async () => {
  const { agents, clock } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  assert.ok(clock.pending.size > 0);
  agents.dispose();
  assert.equal(clock.pending.size, 0);
});

const WORKTREE = "/h/.worktrees/proj/sub-abcdef12";

test("start creates the worktree on the base before the window and gives it as the window cwd", async () => {
  const { agents, gitLog } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  assert.deepEqual(gitLog, [`add ${WORKTREE} sub/abcdef12 ${SOURCE.sha}`]);
});

test("a failed window start removes the worktree; a failed worktree start leaves no entry", async () => {
  const failed = setup({ openFails: true });
  await assert.rejects(failed.agents.start("t", ARGS, [], MODELS, SOURCE), /could not start subagent/);
  assert.deepEqual(failed.gitLog, [`add ${WORKTREE} sub/abcdef12 ${SOURCE.sha}`, `remove ${WORKTREE} sub/abcdef12`]);
  const clock = fakeClock();
  const agents = createAgents({
    session: "pi-sub-abcd1234",
    dir: "/d",
    socket: "/s",
    piCommand: "pi",
    home: "/h",
    git: {
      ...fakeGit(false, []),
      addWorktree: async () => {
        throw new Error("git said no");
      },
    },
    extensions: ["/x"],
    tmux: { openWindow: async () => "@1", listWindows: async () => [], killWindow: async () => {} },
    timers: clock.timers,
    now: () => clock.now(),
    newId: () => ID,
    sendToSub: () => {},
    sendToMains: () => {},
    onChange: () => {},
    onError: () => {},
  });
  await assert.rejects(agents.start("t", ARGS, [], MODELS, SOURCE), /git said no/);
  assert.deepEqual(agents.entries(), []);
});

test("a handoff with changes and a commit keeps the worktree and reports the commit; the supervisor does not commit", async () => {
  const { agents, gitLog, toMains } = setup({ dirty: true });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  const data = { ...SCOUT, change: "feature" as const, changes: [{ file: "a.ts", what: "w" }], findings: [] };
  await agents.handoff(ID, data, undefined, { ok: true, files: ["a.ts"], tests: "green" }, "c".repeat(40));
  assert.deepEqual(gitLog.slice(1), []);
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.deepEqual([message.status, message.worktree, message.branch, message.commit], ["idle", WORKTREE, "sub/abcdef12", "c".repeat(40)]);
  assert.equal(agents.entries()[0]?.worktree, WORKTREE);
});

test("an agent without changes loses its worktree and branch at the end", async () => {
  const { agents, gitLog, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  assert.equal(gitLog.at(-1), `remove ${WORKTREE} sub/abcdef12`);
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.equal(message.worktree, undefined);
  assert.equal(agents.entries()[0]?.worktree, undefined);
  assert.throws(() => agents.answer(ID, "more"), /has no worktree/);
});

test("discard refuses a running agent, removes the worktree of an ended one, and refuses twice", async () => {
  const { agents, gitLog } = setup({ dirty: true });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  await assert.rejects(agents.discard(ID), /runs/);
  await agents.handoff(ID, SCOUT, undefined, GATE, undefined);
  assert.equal(await agents.discard(ID), `removed worktree ${WORKTREE} and branch sub/abcdef12`);
  assert.equal(gitLog.at(-1), `remove ${WORKTREE} sub/abcdef12`);
  await assert.rejects(agents.discard(ID), /has no worktree/);
  await assert.rejects(agents.discard("nope"), /no subagent/);
});

test("a provider error restarts the agent on the next model in the same worktree with the changed files in the task", async () => {
  const { agents, killed, opened, toSub, toMains, gitLog } = setup();
  await agents.start("do it", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  toSub.length = 0;
  agents.event(ID, { kind: "message", text: "a", usage });
  agents.event(ID, { kind: "provider_error", text: "429 rate limit" });
  assert.equal(agents.entries()[0]?.status, "starting");
  await flush();
  await flush();
  assert.deepEqual(killed, ["@1"]);
  assert.equal(opened.length, 2);
  const [first, second] = opened;
  assert.equal(first?.command.at(first.command.indexOf("--model") + 1), "m/x:off");
  assert.equal(second?.command.at(second.command.indexOf("--model") + 1), "m/y:low");
  assert.equal(second?.env?.PI_SUBAGENT_ID, ID);
  assert.equal(agents.entries()[0]?.window, "@2");
  assert.equal(gitLog.filter((entry) => entry.startsWith("add")).length, 1);
  agents.hello(ID);
  assert.deepEqual(toSub, [
    [ID, { type: "task", task: "do it\nThe previous agent stopped on a provider error. Continue the task. Changed files: M a.ts, ?? b.ts." }],
  ]);
  await agents.handoff(ID, HANDOFF, undefined, GATE, undefined);
  const message = toMains[0];
  assert.ok(message?.type === "result");
  assert.equal(message.model, "m/y:low");
  assert.deepEqual(message.failedModels, [{ model: "m/x:off", reason: "429 rate limit" }]);
  assert.deepEqual(message.usage, usage);
});

test("events of the replaced child and the window poll do not change the agent while it restarts", async () => {
  const { agents, clock, setWindows, toMains } = setup();
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  agents.event(ID, { kind: "provider_error", text: "503" });
  setWindows([]);
  agents.event(ID, { kind: "error", text: "late" });
  await clock.advance(2000);
  await flush();
  assert.equal(agents.entries()[0]?.status, "starting");
  assert.equal(toMains.length, 0);
});

test("a model that ended an agent with a provider error is skipped by the next agents for 5 minutes", async () => {
  const first = setup();
  await first.agents.start("t", ARGS, [], MODELS, SOURCE);
  first.agents.hello(ID);
  first.agents.event(ID, { kind: "provider_error", text: "quota" });
  await flush();
  await flush();
  first.agents.hello(ID);
  first.agents.event(ID, { kind: "provider_error", text: "quota" });
  await flush();
  await flush();
  assert.equal(first.opened.length, 3);
  assert.equal(first.opened[2]?.command.at(first.opened[2].command.indexOf("--model") + 1), "m/z");
});

test("an agent that fails on every model ends failed and lists each model with its reason", async () => {
  const { agents, toMains, opened } = setup();
  await agents.start("t", ARGS, [], ["m/x", "m/y"], SOURCE);
  agents.hello(ID);
  agents.event(ID, { kind: "provider_error", text: "429" });
  await flush();
  await flush();
  agents.hello(ID);
  agents.event(ID, { kind: "provider_error", text: "503" });
  await flush();
  assert.equal(opened.length, 2);
  const message = toMains.at(-1);
  assert.ok(message?.type === "result");
  assert.equal(message.status, "failed");
  assert.match(message.text, /no other model is available\. Failed: m\/x: 429; m\/y: 503\./);
  assert.deepEqual(
    message.failedModels?.map((item) => item.model),
    ["m/x", "m/y"],
  );
});

test("a failed restart ends the agent with the reason", async () => {
  const { agents, toMains } = setup({ failOpenAt: 2 });
  await agents.start("t", ARGS, [], MODELS, SOURCE);
  agents.hello(ID);
  agents.event(ID, { kind: "provider_error", text: "429" });
  await flush();
  await flush();
  const message = toMains.at(-1);
  assert.ok(message?.type === "result");
  assert.equal(message.status, "failed");
  assert.match(message.text, /could not restart on m\/y:low after a provider error: tmux down/);
});
