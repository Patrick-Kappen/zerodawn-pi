import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { callFileId, freeId, shorten, storeDir } from "../../../shared/store.ts";
import { age } from "../../../shared/util.ts";
import { DEFAULT_LIMIT_S, MAX_BYTES, MAX_LINES, NO_TIME_LIMIT, STREAM_LINES, STREAM_MS, STREAM_TAIL_BYTES } from "../config.ts";
import type { State } from "../state.ts";
import type { Widget } from "../ui/dashboard.ts";
import { type Job, kill, limitText, type Meta, render, resultText, saveMeta, spawnJob, statsOf } from "./jobproc.ts";
import type { Reports } from "./jobs.ts";

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
    description: `Run a bash command and return its output (up to ${MAX_LINES} lines or ${MAX_BYTES} bytes; longer output: first lines, lines that look like errors, last lines, and the path of the full output). background: true returns the job id at once; the result comes later as a message, or through jobs wait.`,
    promptSnippet: "Run a bash command and wait for it; background: true to keep working",
    promptGuidelines: [
      "Independent commands: put them in one message; they run in parallel.",
      "background: true only for a server, a watcher or a long build. Get the result with jobs wait, or from the message. Never sleep or poll.",
      `A command stops after ${DEFAULT_LIMIT_S / 3600} hour; add "${NO_TIME_LIMIT}" when it must run longer.`,
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({ description: `Timeout in seconds; the job is killed after this time. Default ${DEFAULT_LIMIT_S}, or none with "${NO_TIME_LIMIT}".` }),
      ),
      background: Type.Optional(Type.Boolean({ description: "Run in the background at once; a message reports the result." })),
      group: Type.Optional(Type.String({ description: "Jobs with the same group report together, in one message when the last one ends." })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const outDir = storeDir(ctx, "out");
      const jobsDir = storeDir(ctx, "jobs");
      const id = freeId(callFileId(ctx, toolCallId), (i) => existsSync(join(outDir, `${i}.bash.log`)) || existsSync(join(jobsDir, `${i}.json`)));
      const log = join(outDir, `${id}.bash.log`);
      const base = join(jobsDir, id);
      writeFileSync(`${base}.sh`, `${params.command}\n`);
      const limit = Math.round(params.timeout ?? (params.command.includes(NO_TIME_LIMIT) ? 0 : DEFAULT_LIMIT_S));
      const child = spawnJob({ commandFile: `${base}.sh`, status: `${base}.status`, limit, log, cwd: ctx.cwd });
      const meta: Meta = {
        id,
        command: params.command,
        log,
        status: `${base}.status`,
        pid: child.pid,
        start: Date.now(),
        limit,
        bg: false,
        group: params.group,
        reported: false,
      };
      saveMeta(`${base}.json`, meta);
      const job: Job = {
        id,
        command: params.command,
        log,
        meta: `${base}.json`,
        toolCallId,
        pid: child.pid,
        start: meta.start,
        bg: false,
        group: params.group,
        stats: () => statsOf(log),
      };
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
      waiting.set(id, toBackground);
      if (params.background) toBackground();
      ctx.ui.setStatus("bash-wait", ctx.ui.theme.fg("dim", "bash running · ctrl+shift+b: background"));
      const inline = await Promise.race([done, moved]);
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
