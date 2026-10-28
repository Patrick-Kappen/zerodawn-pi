import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { callFileId, freeId, outRef, storeDir } from "../../../shared/store.ts";
import { age } from "../../../shared/util.ts";
import {
  ALONE_WAIT_S,
  DEFAULT_LIMIT_S,
  INLINE_BYTES,
  INLINE_LINES,
  INLINE_WAIT_S,
  NO_TIME_LIMIT,
  STREAM_LINES,
  STREAM_MS,
  STREAM_TAIL_BYTES,
} from "../config.ts";
import type { State } from "../state.ts";
import type { Widget } from "../ui/dashboard.ts";
import { aloneInMessage } from "./intent.ts";
import { type Job, kill, limitText, type Meta, render, resultText, saveMeta, spawnJob, statsOf } from "./jobproc.ts";
import type { Reports } from "./jobs.ts";
import { isQuick } from "./quick.ts";

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
    description: `Run a bash command for builds, scripts and tools. Read files with read, search with grep, and look at git history with git. Returns the exit status and the output up to ${INLINE_LINES} lines and ${INLINE_BYTES / 1024} KB; longer output gives its size and an out:<name> reference for read (offset=-N for the end) and grep. A failure adds every distinct error line. A quick command (ls, cd, pwd, echo, file operations, git status) returns its result. A bash call that is the only tool call of its message returns its result when it ends within ${ALONE_WAIT_S} s. Every other command returns a job id and runs in the background; a message reports its result. Continue with other work, or end your turn when the next step needs the result. Chain dependent steps in one command with &&, also a wait for a condition: timeout 30 bash -c 'until CHECK; do sleep 1; done' && NEXT.`,
    promptSnippet: "Run a bash command; quick commands give the result, others run in the background",
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      timeout: Type.Optional(
        Type.Number({ description: `Timeout in seconds; the job is killed after this time. Default ${DEFAULT_LIMIT_S}, or none with "${NO_TIME_LIMIT}".` }),
      ),
      group: Type.Optional(Type.String({ description: "Give independent commands in one message the same group; they report together once." })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!statSync(ctx.cwd, { throwIfNoEntry: false })?.isDirectory())
        throw new Error(`bash: the working directory ${ctx.cwd} does not exist. Restart pi in an existing directory.`);
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
      // The agent waits for a call that is alone in its message anyway, so a short command saves it a stop.
      // A command that still runs after the wait (a build, a big directory, a slow disk) moves to the background.
      const alone = aloneInMessage(ctx.sessionManager.getBranch(), toolCallId);
      const wait = alone ? ALONE_WAIT_S : isQuick(params.command) ? INLINE_WAIT_S : 0;
      const autoMove = setTimeout(toBackground, wait * 1000);
      ctx.ui.setStatus("bash-wait", ctx.ui.theme.fg("dim", "bash running · ctrl+shift+b: background"));
      const inline = wait > 0 ? await Promise.race([done, moved]) : undefined;
      clearTimeout(autoMove);
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
      // No terminate: the agent goes on with other work; the bash-job message starts a turn after the run ends.
      return {
        content: [{ type: "text", text: `job ${id}: running · log: ${outRef(log)}` }],
        details: { log, job: id, background: true },
      };
    },
  });
}
