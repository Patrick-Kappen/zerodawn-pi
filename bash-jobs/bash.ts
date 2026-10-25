import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { Key } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NO_TIME_LIMIT, RAW_GIT } from "./guard.ts";
import { DEFAULT_LIMIT_S, type Job, kill, limitText, type Meta, saveMeta, SMALL_BYTES, SMALL_LINES, statsOf, summarize, WRAPPER } from "./jobproc.ts";
import type { Reports } from "./jobs.ts";
import type { State } from "./state.ts";
import { callNumber, freeId, shorten, storeDir } from "../shared/store.ts";
import type { Widget } from "./widget.ts";

const INLINE_MS = 5_000;

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
    description: `Run a bash command. Output up to ${SMALL_BYTES} bytes and ${SMALL_LINES} lines returns in the result. Larger output goes to a log file; the result gives the exit code, the log path and its size. On failure it also returns the last log lines. Commands that run longer than ${INLINE_MS / 1000} seconds, or with background: true, continue in the background; a message reports the result when they end.`,
    promptSnippet: "Run a bash command; small output inline, large output to a log file",
    promptGuidelines: [
      "bash returns small output inline. For large output it returns a log path: use grep or read with offset/limit on the log.",
      `A command that runs longer than ${INLINE_MS / 1000} seconds goes to the background by itself. Use background: true when you know it takes long.`,
      "When you start several jobs that belong together, give them the same group: one message reports them when the last one ends.",
      "A script that runs long prints one progress line per step and flushes it, so the user can follow it live with /jobs.",
      "Do not wait for a background job: no sleep, no repeated jobs calls. End the turn or do other work; a message reports the result.",
      `A bash command stops after ${DEFAULT_LIMIT_S / 3600} hour. Add "${NO_TIME_LIMIT}" to the command only when it must run longer.`,
      "bash blocks commands that show a file (cat, head, tail, nl, sed -n). Use read.",
      `bash blocks git status, diff, log and show. Use the git tool; add "${RAW_GIT}" to the command only when the git tool lacks an option you need.`,
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({ description: `Timeout in seconds; the job is killed after this time. Default ${DEFAULT_LIMIT_S}, or none with "${NO_TIME_LIMIT}".` }),
      ),
      background: Type.Optional(Type.Boolean({ description: "Run in the background at once; a message reports the result." })),
      group: Type.Optional(Type.String({ description: "Jobs with the same group report together, in one message when the last one ends." })),
    }),

    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const outDir = storeDir(ctx, "out");
      const jobsDir = storeDir(ctx, "jobs");
      const id = freeId(callNumber(ctx, toolCallId), (i) => existsSync(join(outDir, `${i}.bash.log`)) || existsSync(join(jobsDir, `${i}.json`)));
      const log = join(outDir, `${id}.bash.log`);
      const base = join(jobsDir, id);
      const shown = shorten(log);

      const fd = openSync(log, "a");
      const limit = Math.round(params.timeout ?? (params.command.includes(NO_TIME_LIMIT) ? 0 : DEFAULT_LIMIT_S));
      const child = spawn("bash", ["-c", WRAPPER, "bash", params.command, `${base}.status`, String(limit)], {
        cwd: ctx.cwd,
        stdio: ["ignore", fd, fd],
        detached: true,
      });
      closeSync(fd);
      const meta: Meta = { id, command: params.command, log, status: `${base}.status`, pid: child.pid, start: Date.now(), limit, bg: false, group: params.group, reported: false };
      saveMeta(`${base}.json`, meta);

      const done = new Promise<string>((resolve) => {
        const finish = (code: number | null, sig: string | null, spawnError?: Error) => {
          const timedOut = sig !== null && limit > 0 && Date.now() >= meta.start + limit * 1000 - 1000;
          const status = spawnError
            ? `failed to start: ${spawnError.message}`
            : timedOut
              ? limitText(limit)
              : sig
                ? `killed by ${sig}`
                : `exit ${code}`;
          resolve(summarize(log, status, !spawnError && !sig && code === 0));
        };
        child.on("error", (err) => finish(null, null, err));
        child.on("exit", (code, sig) => finish(code, sig));
      });
      const job: Job = { id, command: params.command, log, meta: `${base}.json`, pid: child.pid, start: meta.start, bg: false, group: params.group, stats: () => statsOf(log) };
      jobs.set(id, job);

      const abort = () => kill(child.pid);
      signal?.addEventListener("abort", abort, { once: true });
      let toBackground!: () => void;
      const moved = new Promise<undefined>((r) => (toBackground = () => r(undefined)));
      const timer2 = setTimeout(toBackground, params.background ? 0 : INLINE_MS);
      waiting.set(id, toBackground);
      ctx.ui.setStatus("bash-wait", ctx.ui.theme.fg("dim", "bash running · ctrl+shift+b: background"));
      const inline = await Promise.race([done, moved]);
      clearTimeout(timer2);
      waiting.delete(id);
      if (waiting.size === 0) ctx.ui.setStatus("bash-wait", undefined);

      if (inline !== undefined) {
        signal?.removeEventListener("abort", abort);
        job.result = inline;
        jobs.delete(id);
        saveMeta(job.meta, { ...meta, reported: true });
        if (job.group) reports.releaseGroup(job.group, true);
        if (!/^exit 0(\n| |$)/.test(inline)) throw new Error(inline);
        return { content: [{ type: "text", text: inline }], details: { log } };
      }

      signal?.removeEventListener("abort", abort);
      s.ui = ctx.ui;
      job.bg = true;
      meta.bg = true;
      saveMeta(job.meta, meta);
      widget.refresh();
      done.then((text) => reports.report(job, meta, text, true));
      return {
        content: [{ type: "text", text: `running as background job ${id} · log: ${shown} · a message reports the result` }],
        details: { log, job: id },
      };
    },
  });
}
