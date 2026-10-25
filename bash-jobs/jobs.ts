import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Key } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { alive, describe, ending, type Job, kill, type Meta, saveMeta, statsOf, summarizeFromDisk } from "./jobproc.ts";
import { hasBackgroundJob, type State } from "./state.ts";
import { shorten, storeDir } from "../shared/store.ts";
import { commandLine } from "../shared/util.ts";
import { type Widget } from "./dashboard.ts";
import { view } from "./jobview.ts";

const RESEND_MS = 20_000;
const SHOW_ENDED_MS = 30 * 60_000;
const SHOW_ENDED_MAX = 20;

export type JobReport = { jobs: string; items: { id: string; command: string; status: string; ok: boolean; log: string }[] };

export type Reports = {
  report: (job: Job, m: Meta, text: string, triggerTurn: boolean) => void;
  releaseGroup: (group: string, triggerTurn: boolean) => void;
};

export function registerJobs(pi: ExtensionAPI, s: State, widget: Widget): Reports {
  const { jobs } = s;
  const visible = () => {
    for (const [id, j] of jobs) if (j.result && Date.now() - (j.endedAt ?? 0) > SHOW_ENDED_MS) jobs.delete(id);
    const running = [...jobs.values()].filter((j) => !j.result).sort((a, b) => b.start - a.start);
    const ended = [...jobs.values()].filter((j) => j.result).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, SHOW_ENDED_MAX);
    return [...running, ...ended];
  };
  const list = () => {
    const shown = visible();
    return shown.length ? shown.map(describe).join("\n") : "No running bash jobs, and none ended in the last 30 minutes.";
  };
  const killById = (id: string) => {
    const job = jobs.get(id);
    if (!job) throw new Error(`jobs: no job ${id}. Known jobs: ${[...jobs.keys()].join(", ") || "none"}.`);
    if (job.result) return `job ${id} already ended: ${job.result.split("\n")[0]}`;
    kill(job.pid);
    return `job ${id}: SIGTERM sent`;
  };

  const pollers = new Set<ReturnType<typeof setInterval>>();
  let changes = 0;
  let listedAt = -1;
  let agentRunning = false;
  const held: { job: Job; m: Meta; text: string }[] = [];
  let stale = false;
  const unconfirmed = new Map<string, { items: typeof held; sentAt: number }>();
  const send = (items: typeof held, triggerTurn: boolean, whileWorking: boolean) => {
    if (stale) return;
    const key = items.map((it) => it.job.id).join(",");
    unconfirmed.set(key, { items, sentAt: Date.now() });
    const head = `${items.length === 1 ? "A bash job" : `${items.length} bash jobs`} ended${whileWorking ? " while you worked" : ""}.`;
    const decide = whileWorking ? " Decide: use the result now, or finish your current task first." : "";
    const body = items.map((it) => `- job ${it.job.id} (${commandLine(it.job.command, 80)}): ${it.text}`).join("\n");
    const details: JobReport = {
      jobs: key,
      items: items.map((it) => ({ id: it.job.id, command: it.job.command, status: it.text.split("\n")[0].split(" \u00b7 ")[0], ok: it.job.ok === true, log: it.job.log })),
    };
    try {
      pi.sendMessage({ customType: "bash-job", content: `${head}${decide}\n${body}`, display: true, details }, { triggerTurn });
    } catch (err) {
      s.ui?.notify(`bash-jobs: the report of job ${key} failed: ${(err as Error).message}. It is sent again in ${RESEND_MS / 1000} s.`, "error");
    }
  };
  pi.on("message_end", (event) => {
    const m = event.message;
    if (m?.role !== "custom" || m.customType !== "bash-job") return;
    const key = (m.details as { jobs?: unknown } | undefined)?.jobs;
    if (typeof key !== "string") return;
    const sent = unconfirmed.get(key);
    if (!sent) return;
    unconfirmed.delete(key);
    for (const it of sent.items) saveMeta(it.job.meta, { ...it.m, reported: true });
  });
  let isIdle: () => boolean = () => false;
  const resender = setInterval(() => {
    if (stale || agentRunning || !isIdle()) return;
    for (const [key, sent] of unconfirmed)
      if (Date.now() - sent.sentAt > RESEND_MS) {
        unconfirmed.delete(key);
        send(sent.items, true, false);
      }
  }, 5000);
  resender.unref();
  const deliver = (items: typeof held, triggerTurn: boolean) => {
    if (!items.length) return;
    if (agentRunning) held.push(...items);
    else send(items, triggerTurn, false);
  };
  const groups = new Map<string, typeof held>();
  const releaseGroup = (group: string, triggerTurn: boolean) => {
    if ([...jobs.values()].some((j) => j.group === group && !j.result)) return;
    const items = groups.get(group) ?? [];
    groups.delete(group);
    deliver(items, triggerTurn);
  };
  const report = (job: Job, m: Meta, text: string, triggerTurn: boolean) => {
    changes++;
    job.result = text;
    job.ok ??= /^exit 0\b/.test(text);
    job.endedAt = Date.now();
    widget.refresh();
    if (!job.group) return deliver([{ job, m, text }], triggerTurn);
    groups.set(job.group, [...(groups.get(job.group) ?? []), { job, m, text }]);
    releaseGroup(job.group, triggerTurn);
  };
  pi.on("agent_start", () => {
    agentRunning = true;
  });
  pi.on("agent_end", () => {
    agentRunning = false;
    if (held.length) send(held.splice(0), true, true);
  });

  pi.on("session_start", (_event, ctx) => {
    s.ui = ctx.ui;
    isIdle = () => ctx.isIdle();
    if (!ctx.sessionManager.getSessionFile()) return;
    const dir = storeDir(ctx, "jobs");
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const metaPath = join(dir, name);
      let m: Meta;
      try {
        m = JSON.parse(readFileSync(metaPath, "utf8"));
      } catch (err: any) {
        ctx.ui.notify(`tool-output: skipped the unreadable job file ${shorten(metaPath)}: ${err.message}`, "warning");
        continue;
      }
      if (!m.bg || m.reported || jobs.has(m.id)) continue;
      const job: Job = {
        id: m.id,
        command: m.command,
        log: m.log,
        meta: metaPath,
        pid: m.pid,
        start: m.start,
        group: m.group,
        bg: true,
        stats: () => statsOf(m.log),
      };
      jobs.set(m.id, job);
      if (existsSync(m.status) || !alive(m.pid)) {
        report(job, m, summarizeFromDisk(m), false);
        continue;
      }
      const poll = setInterval(() => {
        if (existsSync(m.status) || !alive(m.pid)) {
          clearInterval(poll);
          pollers.delete(poll);
          report(job, m, summarizeFromDisk(m), true);
        }
      }, 2000);
      pollers.add(poll);
    }
    widget.refresh();
  });

  pi.on("session_shutdown", (event) => {
    stale = true;
    clearInterval(resender);
    for (const job of jobs.values()) if (event.reason === "quit" || !job.bg) kill(job.pid);
    widget.stop();
    for (const p of pollers) clearInterval(p);
  });

  const pick = async (ctx: any) => {
    const sorted = visible();
    if (!sorted.length) return ctx.ui.notify("No running bash jobs, and none ended in the last 30 minutes.", "info");
    if (sorted.length === 1) return view(ctx.ui, sorted[0]);
    const label = (j: Job) => `${j.id} · ${ending(j) ?? "running"} · ${commandLine(j.command, 70)}`;
    const chosen = await ctx.ui.select("Bash jobs: pick one to view its output", sorted.map(label));
    const job = sorted.find((j) => label(j) === chosen);
    if (job) await view(ctx.ui, job);
  };
  pi.registerShortcut(Key.ctrlShift("j"), { description: "View the output of a bash job", handler: pick });

  pi.registerCommand("jobs", {
    description: "View the output of a bash job; /jobs list, /jobs show <id>, /jobs kill <id>",
    handler: async (args, ctx) => {
      const [action, id] = (args ?? "").trim().split(/\s+/);
      if (!action) return pick(ctx);
      if (action === "list") return ctx.ui.notify(list(), "info");
      if (action === "show" || action === "kill") {
        if (!id) throw new Error(`/jobs ${action}: give a job id, for example /jobs ${action} 3.2-C1`);
        if (action === "kill") return ctx.ui.notify(killById(id), "info");
        const job = jobs.get(id);
        if (!job) throw new Error(`/jobs show: no job ${id}. Known jobs: ${[...jobs.keys()].join(", ") || "none"}.`);
        return view(ctx.ui, job);
      }
      throw new Error(`/jobs: unknown action "${action}". Use /jobs, /jobs list, /jobs show <id> or /jobs kill <id>.`);
    },
  });

  pi.registerTool({
    name: "jobs",
    label: "jobs",
    description: "List the bash jobs of this session with state, runtime, output size and log path, or kill a running job.",
    promptSnippet: "List or kill bash background jobs",
    promptGuidelines: ["Use jobs only when the user asks for job status or you must decide to kill a job. Do not poll it."],
    parameters: Type.Object({
      action: StringEnum(["list", "kill"] as const),
      id: Type.Optional(Type.String({ description: "kill: the job id" })),
    }),
    async execute(_toolCallId, params) {
      if (params.action === "kill") {
        if (!params.id) throw new Error("jobs kill: give the job id.");
        return { content: [{ type: "text", text: killById(params.id) }], details: {} };
      }
      if (hasBackgroundJob(s) && listedAt === changes)
        throw new Error("No background job changed since your last jobs call. Do not poll: end the turn or do other work. A message reports each result.");
      listedAt = changes;
      return { content: [{ type: "text", text: list() }], details: {} };
    },
  });

  return { report, releaseGroup };
}
