import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { shorten, storeDir } from "../../../shared/store.ts";
import { commandLine } from "../../../shared/util.ts";
import { hasBackgroundJob, type State } from "../state.ts";
import type { Widget } from "../ui/dashboard.ts";
import { closeFollow, toggleFollow } from "../ui/jobview.ts";
import { alive, describe, ending, exitStatus, type Job, kill, type Meta, saveMeta, statsOf, summarizeFromDisk } from "./jobproc.ts";

const RESEND_MS = 20_000;
const LIST_MAX = 50;
const WAIT_MAX_S = 600;

export type JobReport = { jobs: string; items: { id: string; command: string; status: string; ok: boolean; log: string }[] };

export type Reports = {
  report: (job: Job, m: Meta, text: string, triggerTurn: boolean) => void;
  releaseGroup: (group: string, triggerTurn: boolean) => void;
};

export function registerJobs(pi: ExtensionAPI, s: State, widget: Widget): Reports {
  const { jobs } = s;
  const visible = () => {
    const running = [...jobs.values()].filter((j) => !j.result).sort((a, b) => b.start - a.start);
    const ended = [...jobs.values()]
      .filter((j) => j.result)
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, LIST_MAX);
    return [...running, ...ended];
  };
  const list = () => {
    const shown = visible();
    return shown.length ? shown.map(describe).join("\n") : "No bash jobs in this session.";
  };
  // The model gets each result once, from the tool result or the bash-job message, so its list has only running jobs.
  const runningList = () => {
    const running = visible().filter((j) => !j.result);
    return running.length ? running.map(describe).join("\n") : "No running bash jobs. A message reports each result once.";
  };
  const delivered = new Set<string>();
  const statusLine = () =>
    [...jobs.values()]
      .filter((j) => j.bg && !delivered.has(j.id))
      .sort((a, b) => a.start - b.start)
      .map((j) => `${j.id}${j.group ? ` [${j.group}]` : ""}: ${ending(j) ?? "running"}`);
  let noted = new Set<string>();
  pi.on("before_agent_start", (event) => {
    if (event.messageType !== "user") return;
    const now = statusLine();
    if (!now.some((entry) => !noted.has(entry))) return;
    noted = new Set(now);
    return { message: { customType: "bash-status", content: `jobs: ${now.join(" · ")}`, display: false } };
  });
  const killById = (id: string) => {
    const job = jobs.get(id);
    if (!job) throw new Error(`jobs: no job ${id}. Known jobs: ${[...jobs.keys()].join(", ") || "none"}.`);
    if (job.result) return `job ${id}: ended, ${job.result.split("\n")[0]}`;
    kill(job.pid);
    return `job ${id}: killed`;
  };

  const pollers = new Set<ReturnType<typeof setInterval>>();
  let changes = 0;
  let listedAt = "";
  let agentRunning = false;
  const held: { job: Job; m: Meta; text: string }[] = [];
  let stale = false;
  const unconfirmed = new Map<string, { items: typeof held; sentAt: number }>();
  const send = (items: typeof held, triggerTurn: boolean) => {
    if (stale) return;
    const key = items.map((it) => it.job.id).join(",");
    unconfirmed.set(key, { items, sentAt: Date.now() });
    const body = items.map((it) => `job ${it.job.id}: ${it.text}`).join("\n");
    const details: JobReport = {
      jobs: key,
      items: items.map((it) => ({
        id: it.job.id,
        command: it.job.command,
        status: it.text.split("\n")[0].split(" \u00b7 ")[0],
        ok: it.job.ok === true,
        log: it.job.log,
      })),
    };
    try {
      pi.sendMessage({ customType: "bash-job", content: body, display: true, details }, { triggerTurn });
    } catch (err) {
      s.ui?.notify(`bash: the report of job ${key} failed: ${(err as Error).message}. It is sent again in ${RESEND_MS / 1000} s.`, "error");
    }
  };
  pi.on("message_end", (event) => {
    const m = event.message;
    if (m?.role !== "custom" || m.customType !== "bash-job") return;
    const key = (m.details as { jobs?: unknown } | undefined)?.jobs;
    if (typeof key !== "string") return;
    for (const id of key.split(",")) delivered.add(id);
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
        send(sent.items, true);
      }
  }, 5000);
  resender.unref();
  const deliver = (items: typeof held, triggerTurn: boolean) => {
    if (!items.length) return;
    if (agentRunning) held.push(...items);
    else send(items, triggerTurn);
  };
  const groups = new Map<string, typeof held>();
  const releaseGroup = (group: string, triggerTurn: boolean) => {
    if ([...jobs.values()].some((j) => j.group === group && !j.result)) return;
    const items = groups.get(group) ?? [];
    groups.delete(group);
    deliver(items, triggerTurn);
  };
  const waiters = new Map<string, (() => void)[]>();
  const waitFor = (job: Job) =>
    new Promise<void>((resolve) => {
      if (job.result) return resolve();
      waiters.set(job.id, [...(waiters.get(job.id) ?? []), resolve]);
    });
  const reported: (() => void)[] = [];
  const nextReport = () => new Promise<void>((resolve) => reported.push(resolve));
  const report = (job: Job, m: Meta, text: string, triggerTurn: boolean) => {
    changes++;
    for (const resolve of reported.splice(0)) resolve();
    job.result = text;
    job.ok ??= /^exit 0\b/.test(text);
    job.endedAt = Date.now();
    widget.refresh();
    const waiting = waiters.get(job.id);
    if (waiting) {
      waiters.delete(job.id);
      delivered.add(job.id);
      saveMeta(job.meta, { ...m, reported: true });
      for (const resolve of waiting) resolve();
      if (job.group) releaseGroup(job.group, triggerTurn);
      return;
    }
    if (!job.group) return deliver([{ job, m, text }], triggerTurn);
    groups.set(job.group, [...(groups.get(job.group) ?? []), { job, m, text }]);
    releaseGroup(job.group, triggerTurn);
  };
  pi.on("agent_start", () => {
    agentRunning = true;
  });
  // Print and json mode end when the agent settles, so a background report has nobody to read it: keep the run open for it.
  pi.on("agent_before_settle", async (_event, ctx) => {
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    while (!held.length && [...jobs.values()].some((j) => j.bg && !j.result)) await nextReport();
    if (!held.length) return;
    send(held.splice(0), true);
    return { continue: true };
  });
  pi.on("agent_end", () => {
    agentRunning = false;
    if (held.length) send(held.splice(0), true);
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
        ctx.ui.notify(`bash: skipped the unreadable job file ${shorten(metaPath)}: ${err.message}`, "warning");
        continue;
      }
      if (jobs.has(m.id)) continue;
      const job: Job = {
        id: m.id,
        command: m.command,
        log: m.log,
        meta: metaPath,
        pid: m.pid,
        start: m.start,
        group: m.group,
        bg: m.bg,
        stats: () => statsOf(m.log),
      };
      jobs.set(m.id, job);
      if (m.reported) delivered.add(m.id);
      if (!m.bg || m.reported) {
        const status = exitStatus(m.status, m.limit);
        job.result = status ?? "ended";
        job.ok = status === "exit 0";
        job.endedAt = existsSync(m.status) ? statSync(m.status).mtimeMs : m.start;
        continue;
      }
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
    if (s.follow) return closeFollow(s);
    const sorted = visible();
    if (!sorted.length) return ctx.ui.notify("No bash jobs in this session.", "info");
    if (sorted.length === 1) return toggleFollow(pi, s, sorted[0]);
    const label = (j: Job) => `${j.id} · ${ending(j) ?? "running"} · ${commandLine(j.command, 70)}`;
    const chosen = await ctx.ui.select("Bash jobs: pick one to follow in the chat", sorted.map(label));
    const job = sorted.find((j) => label(j) === chosen);
    if (job) toggleFollow(pi, s, job);
  };
  pi.registerShortcut(Key.ctrlShift("j"), { description: "Follow a bash job in the chat, again to close", handler: pick });

  pi.registerCommand("jobs", {
    description: "Follow a bash job in the chat, again to close; /jobs list, /jobs show <id>, /jobs kill <id>",
    handler: async (args, ctx) => {
      const [action, id] = (args ?? "").trim().split(/\s+/);
      if (!action) return pick(ctx);
      if (action === "list") return ctx.ui.notify(list(), "info");
      if (action === "show" || action === "kill") {
        if (!id) throw new Error(`/jobs ${action}: give a job id, for example /jobs ${action} 3.2-C1`);
        if (action === "kill") return ctx.ui.notify(killById(id), "info");
        const job = jobs.get(id);
        if (!job) throw new Error(`/jobs show: no job ${id}. Known jobs: ${[...jobs.keys()].join(", ") || "none"}.`);
        return toggleFollow(pi, s, job);
      }
      throw new Error(`/jobs: unknown action "${action}". Use /jobs, /jobs list, /jobs show <id> or /jobs kill <id>.`);
    },
  });

  pi.registerTool({
    name: "jobs",
    label: "jobs",
    description: `wait: block until the given jobs (default: all running) end and return their results; the user cannot chat while you wait, so only for a short job whose result the next step needs, at most ${WAIT_MAX_S} s. list: the running jobs; a message reports each result once. kill: stop a job.`,
    promptSnippet: "Wait for, list or kill background jobs",
    parameters: Type.Object({
      action: StringEnum(["wait", "list", "kill"] as const),
      id: Type.Optional(Type.String({ description: "kill: the job id. wait: one id, or several separated by commas; default: all running jobs." })),
      timeout: Type.Optional(Type.Number({ description: `wait: seconds to wait at most (default ${WAIT_MAX_S}).` })),
    }),
    async execute(_toolCallId, params, signal) {
      if (params.action === "kill") {
        if (!params.id) throw new Error("jobs kill: give the job id.");
        return { content: [{ type: "text", text: killById(params.id) }], details: { jobs: [params.id] } };
      }
      if (params.action === "wait") {
        const pending = new Set([...held.map((it) => it.job.id), ...[...groups.values()].flat().map((it) => it.job.id)]);
        const ids = params.id ? params.id.split(",").map((x) => x.trim()) : [...jobs.values()].filter((j) => !j.result || pending.has(j.id)).map((j) => j.id);
        const targets = ids.map((id) => {
          const job = jobs.get(id);
          if (!job) throw new Error(`jobs wait: no job ${id}. Known jobs: ${[...jobs.keys()].join(", ") || "none"}.`);
          return job;
        });
        if (!targets.length) return { content: [{ type: "text", text: "No running bash job to wait for." }], details: { jobs: [] as string[] } };
        const limit = Math.min(params.timeout ?? WAIT_MAX_S, WAIT_MAX_S) * 1000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), limit)));
        const abort = new Promise<"abort">((resolve) => signal?.addEventListener("abort", () => resolve("abort"), { once: true }));
        const outcome = await Promise.race([Promise.all(targets.map(waitFor)).then(() => "done" as const), timeout, abort]);
        clearTimeout(timer);
        for (let i = held.length - 1; i >= 0; i--) if (targets.includes(held[i].job)) held.splice(i, 1);
        for (const [group, items] of groups) {
          const rest = items.filter((it) => !targets.includes(it.job));
          if (rest.length === items.length) continue;
          groups.set(group, rest);
          releaseGroup(group, false);
        }
        for (const j of targets) if (j.result) saveMeta(j.meta, { ...JSON.parse(readFileSync(j.meta, "utf8")), reported: true });
        const lines = targets.map((j) => `job ${j.id}: ${j.result ?? "running"}`);
        const head = outcome === "done" ? "" : outcome === "timeout" ? `wait limit ${limit / 1000}s\n` : "wait stopped\n";
        return { content: [{ type: "text", text: `${head}${lines.join("\n")}` }], details: { jobs: targets.map((j) => j.id) } };
      }
      const now = `${changes}/${jobs.size}`;
      if (hasBackgroundJob(s) && listedAt === now) throw new Error("no change since the last jobs call; a message reports each result");
      listedAt = now;
      return { content: [{ type: "text", text: runningList() }], details: { jobs: [] as string[] } };
    },
  });

  return { report, releaseGroup };
}
