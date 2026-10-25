import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { Key } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { callNumber, freeId, shorten, storeDir } from "../shared/store.ts";
import { age } from "../shared/util.ts";
import { DEFAULT_LIMIT_S, FOREGROUND_MS, MAX_BYTES, MAX_LINES, NO_TIME_LIMIT, STREAM_LINES, STREAM_MS, STREAM_TAIL_BYTES } from "./config.ts";
import { type Job, kill, limitText, type Meta, render, resultText, saveMeta, spawnJob, statsOf } from "./jobproc.ts";
import type { Reports } from "./jobs.ts";
import type { State } from "./state.ts";
import type { Widget } from "./dashboard.ts";
import { renderCall, renderResult } from "./render.ts";

export function registerBackgroundShortcut(pi: ExtensionAPI, { waiting }: State) {
  pi.registerShortcut(Key.ctrlShift("b"), {
    description: "Move running bash commands to the background",
    handler: async (ctx) => {
      if (waiting.size === 0) {
        ctx.ui.notify("No bash command is running in the foreground.", "info");
        return;
      }
      for (const move of waiting.values()) move();
    },
  });
}

export function registerBash(pi: ExtensionAPI, s: State, widget: Widget, reports: Reports) {
  const { jobs, waiting } = s;
  pi.registerTool({
    name: "bash",
    label: "bash",
    description: `Run a bash command as a job in its own terminal (PTY). A command that ends within ${FOREGROUND_MS / 1000} seconds returns its output in the result, up to ${MAX_LINES} lines or ${MAX_BYTES} bytes (longer output: the tail and the path of the full log). A command that runs longer, or with background: true, continues in the background: the result returns at once with the job id, and the output comes later as a message, or at once through jobs wait.`,
    promptSnippet: "Run a bash command as a job; short ones return inline, long ones run in the background",
    promptGuidelines: [
      `bash returns the output inline when the command ends within ${FOREGROUND_MS / 1000} seconds. A longer command becomes a background job: a message brings the result when it ends, or call jobs wait when you need it before you continue.`,
      "Use background: true for a command you know takes long: a build, a test suite, a server, a download.",
      "Independent commands: start them all in one message; they run in parallel as separate jobs. Then do other work, or jobs wait for the ones you need.",
      "When you start several jobs that belong together, give them the same group: one message reports them when the last one ends.",
      "Never sleep or poll for a job. Use jobs wait.",
      `A bash command stops after ${DEFAULT_LIMIT_S / 3600} hour. Add "${NO_TIME_LIMIT}" to the command only when it must run longer.`,
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({ description: `Timeout in seconds; the job is killed after this time. Default ${DEFAULT_LIMIT_S}, or none with "${NO_TIME_LIMIT}".` }),
      ),
      background: Type.Optional(Type.Boolean({ description: "Run in the background at once; a message reports the result." })),
      group: Type.Optional(Type.String({ description: "Jobs with the same group report together, in one message when the last one ends." })),
    }),
    renderCall: (args, theme) => renderCall(args, theme),
    renderResult: (result, options, theme) => renderResult(result as any, options, theme),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const outDir = storeDir(ctx, "out");
      const jobsDir = storeDir(ctx, "jobs");
      const id = freeId(callNumber(ctx, toolCallId), (i) => existsSync(join(outDir, `${i}.bash.log`)) || existsSync(join(jobsDir, `${i}.json`)));
      const log = join(outDir, `${id}.bash.log`);
      const base = join(jobsDir, id);
      writeFileSync(`${base}.sh`, `${params.command}\n`);
      const limit = Math.round(params.timeout ?? (params.command.includes(NO_TIME_LIMIT) ? 0 : DEFAULT_LIMIT_S));
      const child = spawnJob({ commandFile: `${base}.sh`, status: `${base}.status`, limit, log, cwd: ctx.cwd });
      const meta: Meta = { id, command: params.command, log, status: `${base}.status`, pid: child.pid, start: Date.now(), limit, bg: false, group: params.group, reported: false };
      saveMeta(`${base}.json`, meta);
      const job: Job = { id, command: params.command, log, meta: `${base}.json`, toolCallId, pid: child.pid, start: meta.start, bg: false, group: params.group, stats: () => statsOf(log) };
      jobs.set(id, job);
      s.ui = ctx.ui;
      widget.refresh();

      const done = new Promise<{ text: string; ok: boolean }>((resolve) => {
        const finish = (code: number | null, sig: string | null, spawnError?: Error) => {
          const elapsed = age(Date.now() - meta.start);
          const timedOut = sig !== null && limit > 0 && Date.now() >= meta.start + limit * 1000 - 1000;
          const status = spawnError
            ? `failed to start: ${spawnError.message}`
            : timedOut
              ? limitText(limit)
              : sig
                ? `killed by ${sig} (${elapsed})`
                : `exit ${code} (${elapsed})`;
          const ok = !spawnError && !sig && code === 0;
          job.ok = ok;
          resolve({ text: resultText(log, status), ok });
        };
        child.on("error", (err) => finish(null, null, err));
        child.on("exit", (code, sig) => finish(code, sig));
      });

      const stream = setInterval(() => {
        const tail = render(log, STREAM_TAIL_BYTES);
        const plain = tail.plain.slice(-STREAM_LINES);
        onUpdate?.({ content: [{ type: "text", text: plain.join("\n") }], details: { log, job: id, lines: tail.lines.slice(-STREAM_LINES) } });
      }, STREAM_MS);

      const abort = () => kill(child.pid);
      signal?.addEventListener("abort", abort, { once: true });
      let toBackground!: () => void;
      const moved = new Promise<undefined>((r) => (toBackground = () => r(undefined)));
      const timer = setTimeout(toBackground, params.background ? 0 : FOREGROUND_MS);
      waiting.set(id, toBackground);
      ctx.ui.setStatus("bash-wait", ctx.ui.theme.fg("dim", "bash running · ctrl+shift+b: background"));
      const inline = await Promise.race([done, moved]);
      clearTimeout(timer);
      clearInterval(stream);
      waiting.delete(id);
      if (waiting.size === 0) ctx.ui.setStatus("bash-wait", undefined);
      signal?.removeEventListener("abort", abort);

      if (inline !== undefined) {
        job.result = inline.text;
        job.endedAt = Date.now();
        saveMeta(job.meta, { ...meta, reported: true });
        widget.refresh();
        if (job.group) reports.releaseGroup(job.group, true);
        if (!inline.ok) throw new Error(inline.text);
        return { content: [{ type: "text", text: inline.text }], details: { log, job: id } };
      }

      job.bg = true;
      meta.bg = true;
      saveMeta(job.meta, meta);
      widget.refresh();
      done.then((r) => reports.report(job, meta, r.text, true));
      return {
        content: [{ type: "text", text: `job ${id} runs in the background · log: ${shorten(log)} · a message reports the result` }],
        details: { log, job: id, background: true },
      };
    },
  });
}
