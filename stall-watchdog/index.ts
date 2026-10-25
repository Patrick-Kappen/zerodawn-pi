/**
 * Stall watchdog: recovers pi runs that hang without a visible error.
 *
 * Runs silently. After 2/3 of the threshold without activity it collects evidence
 * (stream, running tools, child processes of pi, tail of the session) and asks
 * the classifier whether the run hangs for sure.
 * If so: abort, go back through the tree to the last working point, continue.
 * The third time within one prompt: stop the agent and report.
 *
 * Env:
 *   PI_WATCHDOG_STALL_S       threshold without a running tool (default 180)
 *   PI_WATCHDOG_TOOL_STALL_S  threshold while a tool runs (default 180); CPU use of child processes counts as activity
 *   PI_WATCHDOG_CERTAINTY     minimum probability of "hangs" (default 0.75)
 *   PI_WATCHDOG_CLASSIFIER    classifier model as provider/model (default typesafe/jev-latest); without it the watchdog never aborts
 */
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const STALL_MS = num(process.env.PI_WATCHDOG_STALL_S, 180) * 1000;
const TOOL_STALL_MS = num(process.env.PI_WATCHDOG_TOOL_STALL_S, 180) * 1000;
const CERTAINTY = num(process.env.PI_WATCHDOG_CERTAINTY, 0.75);
const CLASSIFIER = (process.env.PI_WATCHDOG_CLASSIFIER ?? "typesafe/jev-latest").split("/") as [string, string];
const MAX_STALLS = 3;
const TICK_MS = 5000;
const CONTINUE_TEXT = "Your previous answer hung and was aborted automatically. Continue where you were.";

type Tool = {
  name: string;
  args: string;
  startedAt: number;
  lastUpdate: number;
};
type Proc = {
  pid: number;
  cmd: string;
  state: string;
  cpuTicks: number;
  wchan: string;
  stdin: string;
};

const readOr = (f: () => string, d = "") => {
  try {
    return f();
  } catch {
    return d;
  }
};

/** All descendants of this process (Linux /proc). */
function descendants(root = process.pid): Proc[] {
  const out: Proc[] = [];
  const walk = (pid: number, depth: number) => {
    if (depth > 8) return;
    let tasks: string[] = [];
    try {
      tasks = readdirSync(`/proc/${pid}/task`);
    } catch {
      return;
    }
    for (const t of tasks) {
      let kids: string[] = [];
      try {
        kids = readFileSync(`/proc/${pid}/task/${t}/children`, "utf8").trim().split(/\s+/).filter(Boolean);
      } catch {}
      for (const k of kids) {
        const child = Number(k);
        try {
          const stat = readFileSync(`/proc/${child}/stat`, "utf8");
          const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          const cmd = readFileSync(`/proc/${child}/cmdline`, "utf8").replace(/\0/g, " ").trim().slice(0, 200);
          out.push({
            pid: child,
            cmd,
            state: rest[0],
            cpuTicks: Number(rest[11]) + Number(rest[12]),
            wchan: readOr(() => readFileSync(`/proc/${child}/wchan`, "utf8")),
            stdin: readOr(() => readlinkSync(`/proc/${child}/fd/0`)),
          });
        } catch {
          continue;
        }
        walk(child, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

const clip = (v: unknown, n: number) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** Short summary of the last session entries. */
function sessionTail(ctx: ExtensionContext, n = 8) {
  return (ctx.sessionManager.getBranch() as any[]).slice(-n).map((e) => {
    if (e.type !== "message") return { type: e.type, at: e.timestamp };
    const m = e.message;
    const text = Array.isArray(m.content)
      ? m.content.map((c: any) => (c.type === "text" ? c.text : c.type === "toolCall" ? `[call ${c.name}]` : `[${c.type}]`)).join(" ")
      : m.content;
    return {
      role: m.role,
      stopReason: m.stopReason,
      isError: m.isError,
      tool: m.toolName,
      text: clip(text, 300),
      at: e.timestamp,
    };
  });
}

export default function (pi: ExtensionAPI) {
  let busy = false;
  let lastActivity = Date.now();
  let lastEvent = "";
  let lastStreamAt = 0;
  let streaming = false;
  const tools = new Map<string, Tool>();
  let stalls = 0;
  let nextCheckAt = 0;
  let working = false;
  let ctxRef: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let procSample = new Map<number, number>();

  const touch = (ev: string) => {
    lastActivity = Date.now();
    lastEvent = ev;
    nextCheckAt = 0;
  };

  for (const ev of ["turn_start", "turn_end", "message_end", "auto_retry_start", "auto_retry_end", "compaction_start", "compaction_end"] as const)
    pi.on(ev as any, async () => touch(ev));

  pi.on("message_start", async () => {
    streaming = true;
    touch("message_start");
  });
  pi.on("message_update", async () => touch("message_update"));
  pi.on("message_end", async () => {
    streaming = false;
  });
  pi.on("provider_stream_event", async () => {
    lastStreamAt = Date.now();
    touch("provider_stream_event");
  });
  pi.on("tool_execution_start", async (e: any) => {
    const now = Date.now();
    tools.set(e.toolCallId, {
      name: e.toolName,
      args: clip(e.args, 400),
      startedAt: now,
      lastUpdate: now,
    });
    touch("tool_execution_start");
  });
  pi.on("tool_execution_update", async (e: any) => {
    const t = tools.get(e.toolCallId);
    if (t) t.lastUpdate = Date.now();
    touch("tool_execution_update");
  });
  pi.on("tool_execution_end", async (e: any) => {
    tools.delete(e.toolCallId);
    touch("tool_execution_end");
  });

  pi.on("input", async (e: any) => {
    if (e?.source !== "extension") stalls = 0;
  });
  pi.on("agent_start", async (_e, ctx) => {
    ctxRef = ctx;
    busy = true;
    streaming = false;
    tools.clear();
    touch("agent_start");
  });
  pi.on("agent_end", async () => {
    busy = false;
    tools.clear();
  });

  /** Asks the classifier whether the run hangs for sure. Errors = not sure. */
  async function confirmStall(ctx: ExtensionContext, idleMs: number, limitMs: number): Promise<boolean> {
    const now = Date.now();
    // Every tick with CPU progress counts as activity, so no child used CPU during idleSeconds.
    const processes = descendants().map((p) => ({
      cmd: p.cmd,
      state: p.state,
      waitingIn: p.wchan,
      stdin: p.stdin,
      usedCpuDuringIdle: false,
    }));

    const state = {
      idleSeconds: Math.round(idleMs / 1000),
      thresholdSeconds: Math.round(limitMs / 1000),
      lastEvent,
      assistantMessageStreaming: streaming,
      secondsSinceLastStreamEvent: lastStreamAt ? Math.round((now - lastStreamAt) / 1000) : null,
      runningTools: [...tools.values()].map((t) => ({
        name: t.name,
        args: t.args,
        runningSeconds: Math.round((now - t.startedAt) / 1000),
        secondsSinceLastUpdate: Math.round((now - t.lastUpdate) / 1000),
      })),
      childProcesses: processes,
      sessionTail: sessionTail(ctx),
    };

    const reg = ctx.modelRegistry as any;
    const model = reg.findOfType?.("classifier", ...CLASSIFIER);
    if (!model) return false;
    // The classifier tells a hanging command from deliberate waiting only with a question per situation.
    const question =
      tools.size > 0
        ? {
            type: "bool",
            instructions:
              "A shell command started by a coding agent has used zero CPU and produced zero output for idleSeconds. Kernel wait channel is in `waitingIn`. Will it finish on its own soon? Answer true if it is blocked indefinitely: waiting on a file lock held by someone else, waiting on a terminal/credential/editor prompt, or on a network socket with no timeout. Answer false if the command itself is an intentional sleep, a polling loop with sleep, or has an explicit timeout that has not yet expired.",
            criteria: {
              true: "Blocked indefinitely; it will not finish by itself.",
              false: "Intentional wait or bounded; it will finish by itself.",
            },
          }
        : {
            type: "bool",
            instructions:
              "A coding agent is waiting for a model response that has produced no stream events for idleSeconds. Is the response stream certainly dead?",
            criteria: {
              true: "The stream stopped; no further output will come.",
              false: "The model may still be thinking or the provider is still retrying.",
            },
          };
    try {
      const res = await reg.classify(model, {
        state,
        questions: { stalled: question },
      });
      const a = res?.stopReason === "stop" ? res.answers?.stalled : undefined;
      return a?.type === "bool" && a.probability >= CERTAINTY;
    } catch {
      return false;
    }
  }

  const tick = async () => {
    const ctx = ctxRef;
    if (!ctx || !busy || working) return;
    const limit = tools.size > 0 ? TOOL_STALL_MS : STALL_MS;
    if (tools.size > 0) {
      const procs = descendants();
      const progressed = procs.some((p) => procSample.has(p.pid) && p.cpuTicks > (procSample.get(p.pid) ?? 0));
      procSample = new Map(procs.map((p) => [p.pid, p.cpuTicks]));
      if (progressed) touch("child_cpu");
    }
    const idle = Date.now() - lastActivity;
    if (idle < (limit * 2) / 3 || Date.now() < nextCheckAt) return;

    working = true;
    try {
      if (!(await confirmStall(ctx, idle, limit))) {
        nextCheckAt = Date.now() + limit / 3;
        return;
      }
      if (!busy || Date.now() - lastActivity < idle) return; // active again in the meantime

      stalls++;
      ctx.abort();
      const deadline = Date.now() + 30_000;
      while (!ctx.isIdle() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      busy = false;

      if (stalls >= MAX_STALLS) {
        ctx.ui.notify(`Agent stalled ${MAX_STALLS} times, stopped.`, "error");
        return;
      }
      pi.sendUserMessage("/unstick", { expandPromptTemplates: true } as any);
    } catch {
      // silent: no noise in the UI
    } finally {
      working = false;
    }
  };

  pi.on("session_start", async (_e, ctx) => {
    ctxRef = ctx;
    if (!timer) timer = setInterval(() => void tick(), TICK_MS);
  });
  pi.on("session_shutdown", async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    ctxRef = undefined;
    busy = false;
  });

  pi.registerCommand("unstick", {
    description: "Abort a hanging run, go back to the last working point and continue",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.abort();
        await ctx.waitForIdle();
      }
      const branch = ctx.sessionManager.getBranch() as any[];
      let i = branch.length - 1;
      for (; i >= 0; i--) {
        const e = branch[i];
        if (e.type !== "message") continue;
        const m = e.message;
        if (m.role === "assistant" && (m.stopReason === "aborted" || m.stopReason === "error")) continue;
        if (m.role === "toolResult" && m.isError) continue;
        break;
      }
      if (i < 0) return;

      const target = branch[i];
      const res = await ctx.navigateTree(target.id, { label: "unstick" });
      if (res.cancelled) return;

      if (target.message.role === "user") {
        ctx.ui.setEditorText("");
        pi.sendUserMessage(target.message.content);
      } else {
        pi.sendUserMessage(CONTINUE_TEXT);
      }
      ctx.ui.notify(`Stalled run recovered (${stalls}/${MAX_STALLS}).`, "info");
    },
  });
}
