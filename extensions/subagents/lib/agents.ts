import type { Timers } from "./lifecycle.ts";
import type { AgentResult, AgentStatus, ServerMessage, SubEvent, Usage } from "./protocol.ts";
import type { AgentEntry } from "./register.ts";
import type { Tmux } from "./tmux.ts";

export const HELLO_TIMEOUT_MS = 30_000;
export const POLL_MS = 2000;
export const MAX_EVENTS = 20;
export const MAX_LINE = 200;

export interface AgentsOptions {
  session: string;
  dir: string;
  socket: string;
  piCommand: string;
  extensions: string[];
  tmux: Pick<Tmux, "openWindow" | "listWindows">;
  timers: Timers;
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
  task: string;
  events: string[];
  text: string;
  usage: Usage;
  helloTimer: unknown;
  pending?: { kind: "question" | "blocked"; text: string };
}

function line(text: string): string {
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text;
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
      status: record.entry.status === "failed" || record.entry.status === "question" || record.entry.status === "blocked" ? record.entry.status : "idle",
      text: record.text,
      usage: record.usage,
      events: record.events,
    };
  }

  function finish(record: AgentRecord, status: AgentStatus, text: string): void {
    options.timers.clearTimeout(record.helloTimer);
    record.entry.status = status;
    record.text = text;
    options.onChange();
    options.sendToMains({ type: "result", ...result(record) });
  }

  function fail(record: AgentRecord, reason: string): void {
    finish(record, "failed", reason);
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
      if (active(record) && !windows.has(record.entry.window)) {
        fail(record, `subagent ${record.entry.id} ended without a result: its window ${record.entry.window} is gone. Run: tmux attach -t ${options.session}`);
      }
    }
  }

  async function start(task: string, args: string[], checks: string[]): Promise<string> {
    const id = options.newId();
    const record: AgentRecord = {
      entry: { id, role: "sub", window: "", status: "starting" },
      task,
      events: [],
      text: "",
      usage: { tokens: 0, cost: 0 },
      helloTimer: undefined,
    };
    records.set(id, record);
    entries.push(record.entry);
    const command = [
      options.piCommand,
      "-ne",
      "-ns",
      "-np",
      "-nc",
      "--no-themes",
      ...options.extensions.flatMap((path) => ["-e", path]),
      ...args,
      "--session-id",
      id,
      "--session-dir",
      `${options.dir}/sessions`,
    ];
    try {
      record.entry.window = await options.tmux.openWindow(options.session, `sub-${id.slice(0, 4)}`, command, {
        PI_SUBAGENT_SOCKET: options.socket,
        PI_SUBAGENT_ID: id,
        PI_SUBAGENT_CHECKS: JSON.stringify(checks),
      });
    } catch (cause) {
      records.delete(id);
      entries.splice(entries.indexOf(record.entry), 1);
      throw new Error(`supervisor: could not start subagent ${id}. Make sure tmux runs and "${options.piCommand}" is in PATH.`, { cause });
    }
    record.helloTimer = options.timers.setTimeout(() => fail(record, `subagent ${id} did not connect; run tmux attach -t ${options.session}`), helloTimeoutMs);
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

  function event(id: string, value: SubEvent): void {
    const record = find(id);
    // A late event of an agent that already failed must not change its result.
    if (record.entry.status === "failed") return;
    record.events.push(formatEvent(value));
    if (record.events.length > MAX_EVENTS) record.events.shift();
    if (value.kind === "message") {
      record.usage = { tokens: record.usage.tokens + value.usage.tokens, cost: record.usage.cost + value.usage.cost };
    } else if (value.kind === "error") {
      fail(record, value.text);
    } else if (value.kind === "settled" && record.entry.status === "running") {
      const pending = record.pending;
      record.pending = undefined;
      if (pending === undefined) finish(record, "idle", value.text);
      else finish(record, pending.kind, pending.text);
    }
  }

  function pending(id: string, kind: "question" | "blocked", text: string): void {
    const record = find(id);
    if (record.entry.status !== "running") {
      throw new Error(`supervisor: subagent ${id} has status "${record.entry.status}" and cannot send a ${kind === "question" ? "question" : "blocker"}.`);
    }
    record.pending = { kind, text };
  }

  function answer(id: string, text: string): void {
    if (text.trim() === "") throw new Error('supervisor: an "answer" needs a non-empty text.');
    const record = find(id);
    const status = record.entry.status;
    if (status !== "idle" && status !== "question" && status !== "blocked") {
      throw new Error(`supervisor: subagent ${id} has status "${status}". Use "answer" only for status idle, question or blocked.`);
    }
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

  return { start, hello, event, pending, answer, running, dispose, entries: () => entries };
}
