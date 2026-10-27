import { basename, join } from "node:path";
import { type Blocker, type GateInfo, type Handoff, handoffText } from "./format.ts";
import type { Git, Source } from "./git.ts";
import type { Timers } from "./lifecycle.ts";
import { createMarks } from "./models.ts";
import type { AgentResult, AgentStatus, FailedModel, ServerMessage, SubEvent, Usage } from "./protocol.ts";
import type { AgentEntry } from "./register.ts";
import type { Tmux } from "./tmux.ts";

export const HELLO_TIMEOUT_MS = 30_000;
export const POLL_MS = 2000;
export const MAX_EVENTS = 20;
export const MAX_LINE = 200;
export const MAX_TOKENS = 100_000;

export interface AgentsOptions {
  session: string;
  dir: string;
  socket: string;
  piCommand: string;
  home: string;
  git: Git;
  extensions: string[];
  tmux: Pick<Tmux, "openWindow" | "listWindows" | "killWindow">;
  timers: Timers;
  now: () => number;
  newId: () => string;
  sendToSub: (id: string, message: ServerMessage) => void;
  sendToMains: (message: ServerMessage) => void;
  onChange: () => void;
  onError: (error: Error) => void;
  helloTimeoutMs?: number;
  pollMs?: number;
}

interface AgentRecord {
  entry: AgentEntry;
  repo: string;
  task: string;
  baseTask: string;
  args: string[];
  checks: string[];
  models: string[];
  current: number;
  failed: FailedModel[];
  sessionId: string;
  restarting?: boolean;
  events: string[];
  text: string;
  usage: Usage;
  helloTimer: unknown;
  pending?: { kind: "question" | "blocked"; text: string; blocker?: Blocker };
  extra: Pick<AgentResult, "blocker" | "handoff" | "reason" | "gate" | "commit">;
  handingOff?: boolean;
  concluding?: boolean;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function line(text: string): string {
  return cut(text, MAX_LINE);
}

export function formatEvent(event: SubEvent): string {
  switch (event.kind) {
    case "tool_start":
      return line(`tool ${event.name} ${event.args}`);
    case "tool_end":
      return line(`tool ${event.name} ${event.isError ? "failed" : "done"}`);
    case "message":
      return line(`message ${event.text}`);
    case "settled":
      return line(`settled ${event.text}`);
    case "gate":
      return line(`gate ${event.ok ? "green" : "red"}${event.text ? `: ${event.text}` : ""}`);
    case "error":
      return line(`error ${event.text}`);
    case "provider_error":
      return line(`provider error ${event.text}`);
  }
}

export function createAgents(options: AgentsOptions) {
  const records = new Map<string, AgentRecord>();
  const entries: AgentEntry[] = [];
  const helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
  const pollMs = options.pollMs ?? POLL_MS;
  let pollTimer: unknown;
  let polling = false;
  let disposed = false;
  const marks = createMarks(options.now);

  // "question" and "blocked" are not active: the agent waits for the main agent.
  function active(record: AgentRecord): boolean {
    return record.entry.status === "starting" || record.entry.status === "running";
  }

  function running(): boolean {
    return [...records.values()].some(active);
  }

  function result(record: AgentRecord): AgentResult {
    return {
      id: record.entry.id,
      status: record.entry.status === "starting" || record.entry.status === "running" ? "idle" : record.entry.status,
      text: record.text,
      usage: record.usage,
      events: record.events,
      model: record.models[record.current] as string,
      ...(record.failed.length === 0 ? {} : { failedModels: record.failed }),
      ...record.extra,
      ...(record.entry.worktree === undefined ? {} : { worktree: record.entry.worktree, branch: record.entry.branch }),
    };
  }

  function finish(record: AgentRecord, status: AgentStatus, text: string, extra: AgentRecord["extra"] = {}): void {
    record.extra = extra;
    options.timers.clearTimeout(record.helloTimer);
    record.entry.status = status;
    record.text = text;
    options.onChange();
    options.sendToMains({ type: "result", ...result(record) });
  }

  async function drop(record: AgentRecord): Promise<string | undefined> {
    const { worktree, branch } = record.entry;
    if (worktree === undefined || branch === undefined) return undefined;
    await options.git.removeWorktree(record.repo, worktree, branch);
    delete record.entry.worktree;
    delete record.entry.branch;
    options.onChange();
    return `removed worktree ${worktree} and branch ${branch}`;
  }

  // The end of an agent: a worktree without changes goes away.
  async function conclude(record: AgentRecord, status: AgentStatus, text: string, extra: AgentRecord["extra"] = {}): Promise<void> {
    if (record.concluding) return;
    record.concluding = true;
    options.timers.clearTimeout(record.helloTimer);
    const { worktree } = record.entry;
    try {
      if (worktree !== undefined) {
        const state = await options.git.state(worktree, record.entry.base);
        if (!state.dirty && !state.moved) await drop(record);
      }
    } catch (cause) {
      finish(
        record,
        "failed",
        `subagent ${record.entry.id} ended, but git failed in its worktree ${worktree}. Read the error, fix the worktree by hand or discard it: ${(cause as Error).message}`,
      );
      return;
    }
    finish(record, status, text, extra);
  }

  function fail(record: AgentRecord, reason: string): void {
    conclude(record, "failed", reason).catch(options.onError);
  }

  function schedulePoll(): void {
    if (polling || disposed) return;
    polling = true;
    pollTimer = options.timers.setTimeout(() => {
      polling = false;
      poll().then(
        () => {
          if (running()) schedulePoll();
        },
        (cause) => options.onError(new Error(`supervisor: could not list the windows of "${options.session}".`, { cause })),
      );
    }, pollMs);
  }

  async function poll(): Promise<void> {
    const windows = new Set((await options.tmux.listWindows(options.session)).map((window) => window.id));
    for (const record of records.values()) {
      if (active(record) && !record.restarting && !windows.has(record.entry.window)) {
        fail(record, `subagent ${record.entry.id} ended without a result: its window ${record.entry.window} is gone. Run: tmux attach -t ${options.session}`);
      }
    }
  }

  function openWindow(record: AgentRecord): Promise<string> {
    const { id } = record.entry;
    const command = [
      options.piCommand,
      "-ne",
      "-ns",
      "-np",
      "-nc",
      "--no-themes",
      ...options.extensions.flatMap((path) => ["-e", path]),
      ...record.args,
      "--model",
      record.models[record.current] as string,
      "--session-id",
      record.sessionId,
      "--session-dir",
      `${options.dir}/sessions`,
    ];
    return options.tmux.openWindow(
      options.session,
      `sub-${id.slice(0, 4)}`,
      command,
      { PI_SUBAGENT_SOCKET: options.socket, PI_SUBAGENT_ID: id, PI_SUBAGENT_CHECKS: JSON.stringify(record.checks) },
      record.entry.worktree,
    );
  }

  async function start(task: string, args: string[], checks: string[], models: string[], source: Source): Promise<string> {
    if (models.length === 0) throw new Error("supervisor: a start needs at least one model.");
    const id = options.newId();
    const worktree = join(options.home, ".worktrees", basename(source.repo), `sub-${id.slice(0, 8)}`);
    const branch = `sub/${id.slice(0, 8)}`;
    await options.git.addWorktree({ ...source, path: worktree, branch });
    const record: AgentRecord = {
      entry: { id, role: "sub", window: "", status: "starting", base: source.sha, worktree, branch },
      repo: source.repo,
      task,
      baseTask: task,
      args,
      checks,
      models,
      current: 0,
      failed: [],
      sessionId: id,
      events: [],
      text: "",
      usage: { tokens: 0, cost: 0 },
      helloTimer: undefined,
      extra: {},
    };
    records.set(id, record);
    entries.push(record.entry);
    try {
      record.entry.window = await openWindow(record);
    } catch (cause) {
      records.delete(id);
      entries.splice(entries.indexOf(record.entry), 1);
      const cleanup = await options.git.removeWorktree(source.repo, worktree, branch).then(
        () => "",
        (error: Error) => ` The worktree "${worktree}" stays: ${error.message}`,
      );
      throw new Error(`supervisor: could not start subagent ${id}. Make sure tmux runs and "${options.piCommand}" is in PATH.${cleanup}`, { cause });
    }
    armHello(record);
    options.onChange();
    schedulePoll();
    return id;
  }

  function find(id: string): AgentRecord {
    const record = records.get(id);
    if (record === undefined) throw new Error(`supervisor: no subagent with id "${id}". Start it with a "start" message.`);
    return record;
  }

  function hello(id: string): void {
    const record = find(id);
    if (record.entry.status !== "starting") {
      throw new Error(`supervisor: subagent ${id} has status "${record.entry.status}" and cannot say hello again.`);
    }
    options.timers.clearTimeout(record.helloTimer);
    record.entry.status = "running";
    options.onChange();
    options.sendToSub(id, { type: "task", task: record.task });
  }

  function failedList(record: AgentRecord): string {
    return record.failed.map((item) => `${item.model}: ${item.reason}`).join("; ");
  }

  function armHello(record: AgentRecord): void {
    const { id } = record.entry;
    record.helloTimer = options.timers.setTimeout(() => fail(record, `subagent ${id} did not connect; run tmux attach -t ${options.session}`), helloTimeoutMs);
  }

  // Max one restart per model: the index only moves forward.
  function providerError(record: AgentRecord, reason: string): void {
    if (record.entry.status !== "running" || record.concluding) return;
    const { id } = record.entry;
    record.failed.push({ model: record.models[record.current] as string, reason });
    marks.mark(record.models[record.current] as string);
    const next = record.models.findIndex((model, index) => index > record.current && !marks.marked(model));
    if (next === -1) {
      fail(
        record,
        `subagent ${id} stopped on a provider error and no other model is available. Failed: ${failedList(record)}. Check the providers, or "subagentModels" in config.json.`,
      );
      return;
    }
    record.restarting = true;
    record.entry.status = "starting";
    options.onChange();
    restart(record, next).catch((cause: Error) => {
      record.restarting = false;
      fail(record, `subagent ${id} could not restart on ${record.models[next]} after a provider error: ${cause.message}`);
    });
  }

  async function restart(record: AgentRecord, next: number): Promise<void> {
    const { worktree, window } = record.entry;
    if (worktree === undefined) throw new Error("the agent has no worktree");
    const changed = await options.git.changed(worktree);
    await options.tmux.killWindow(window);
    record.current = next;
    record.sessionId = options.newId();
    record.task = `${record.baseTask}\nThe previous agent stopped on a provider error. Continue the task. Changed files: ${changed.join(", ") || "none"}.`;
    record.events.push(line(`restart on ${record.models[next]} after: ${failedList(record)}`));
    if (record.events.length > MAX_EVENTS) record.events.shift();
    record.entry.window = await openWindow(record);
    record.restarting = false;
    armHello(record);
    options.onChange();
    schedulePoll();
  }

  function event(id: string, value: SubEvent): void {
    const record = find(id);
    // A late event of an agent that already failed, or of the child that a restart replaces, must not change its result.
    if (record.entry.status === "failed" || record.restarting) return;
    record.events.push(formatEvent(value));
    if (record.events.length > MAX_EVENTS) record.events.shift();
    if (value.kind === "message") {
      record.usage = { tokens: record.usage.tokens + value.usage.tokens, cost: record.usage.cost + value.usage.cost };
      if (record.usage.tokens >= MAX_TOKENS && record.entry.status === "running" && !record.handingOff) {
        record.handingOff = true;
        record.events.push(line(`token limit ${MAX_TOKENS} reached (${record.usage.tokens} tokens): handoff`));
        options.sendToSub(id, { type: "handoff" });
      }
    } else if (value.kind === "error") {
      fail(record, value.text);
    } else if (value.kind === "provider_error") {
      providerError(record, value.text);
    } else if (value.kind === "settled" && record.entry.status === "running" && !record.concluding) {
      const pending = record.pending;
      record.pending = undefined;
      if (pending === undefined)
        fail(record, `subagent ${id} settled without a handoff, a question or a blocker. Read its window: tmux attach -t ${options.session}`);
      else finish(record, pending.kind, pending.text, pending.blocker === undefined ? {} : { blocker: pending.blocker });
    }
  }

  // The checks throw at once; the result follows.
  function handoff(id: string, data: Handoff, reason: string | undefined, gate: GateInfo | undefined, commit: string | undefined): Promise<void> {
    const record = find(id);
    if (record.entry.status !== "running" || record.concluding) {
      throw new Error(`supervisor: subagent ${id} has status "${record.entry.status}" and cannot send a handoff.`);
    }
    record.pending = undefined;
    return conclude(record, gate === undefined ? "handoff" : "idle", handoffText(data, gate, reason), {
      handoff: data,
      ...(reason === undefined ? {} : { reason }),
      ...(gate === undefined ? {} : { gate }),
      ...(commit === undefined ? {} : { commit }),
    });
  }

  async function discard(id: string): Promise<string> {
    const record = find(id);
    if (active(record)) throw new Error(`supervisor: subagent ${id} runs. Wait for its result, then discard it.`);
    const removed = await drop(record);
    if (removed === undefined) {
      throw new Error(`supervisor: subagent ${id} has no worktree. It ended without changes, or it was discarded before.`);
    }
    return removed;
  }

  function pending(id: string, kind: "question" | "blocked", text: string, blocker?: Blocker): void {
    const record = find(id);
    if (record.entry.status !== "running") {
      throw new Error(`supervisor: subagent ${id} has status "${record.entry.status}" and cannot send a ${kind === "question" ? "question" : "blocker"}.`);
    }
    record.pending = blocker === undefined ? { kind, text } : { kind, text, blocker };
  }

  function answer(id: string, text: string): void {
    if (text.trim() === "") throw new Error('supervisor: an "answer" needs a non-empty text.');
    const record = find(id);
    const status = record.entry.status;
    if (status !== "idle" && status !== "question" && status !== "blocked") {
      throw new Error(`supervisor: subagent ${id} has status "${status}". Use "answer" only for status idle, question or blocked.`);
    }
    if (record.entry.worktree === undefined) {
      throw new Error(`supervisor: subagent ${id} has no worktree. It ended without changes, or it was discarded. Start a new agent.`);
    }
    record.concluding = false;
    record.baseTask = text;
    options.sendToSub(id, { type: "task", task: text });
    record.entry.status = "running";
    options.onChange();
    schedulePoll();
  }

  function dispose(): void {
    disposed = true;
    options.timers.clearTimeout(pollTimer);
    for (const record of records.values()) options.timers.clearTimeout(record.helloTimer);
  }

  return { start, hello, event, pending, handoff, discard, answer, running, dispose, entries: () => entries };
}
