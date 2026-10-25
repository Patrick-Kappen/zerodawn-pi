import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ending, type Job } from "./jobproc.ts";
import { HEIGHT_SHARE, JobLogView } from "./jobview.ts";
import type { State } from "./state.ts";
import { age, commandLine } from "../shared/util.ts";

const WIDGET_MAX = 3;

export async function view(ui: any, job: Job) {
  const state = () => ending(job) ?? (job.bg ? "running in the background" : "running");
  await ui.custom(
    (tui: any, theme: any, _keys: any, done: (r: undefined) => void) =>
      new JobLogView({ id: job.id, command: job.command, log: job.log, start: job.start, state }, tui, theme, () => done(undefined)),
    { overlay: true, overlayOptions: { anchor: "center", width: "80%", maxHeight: `${HEIGHT_SHARE * 100}%` } },
  );
}

export type Widget = {
  refresh: () => void;
  stop: () => void;
};

export function createWidget(s: State): Widget {
  let ticker: ReturnType<typeof setInterval> | undefined;
  let mounted: any;
  let widgetTui: any;
  const backgroundRunning = () => [...s.jobs.values()].filter((j) => j.bg && !j.result).sort((a, b) => a.start - b.start);
  const refresh = () => {
    if (backgroundRunning().length === 0) {
      if (ticker) clearInterval(ticker);
      ticker = undefined;
      mounted?.setWidget("bash-jobs", undefined, { placement: "aboveEditor" });
      mounted = widgetTui = undefined;
      return;
    }
    ticker ??= setInterval(() => widgetTui?.requestRender(), 1000);
    if (mounted === s.ui) return widgetTui?.requestRender();
    mounted = s.ui;
    s.ui?.setWidget(
      "bash-jobs",
      (tui: any, theme: any) => {
        widgetTui = tui;
        let shown: Job[] = [];
        return {
          render(width: number) {
            const running = backgroundRunning();
            shown = running.slice(0, WIDGET_MAX);
            const lines = shown.map((j) => {
              const head = `${theme.fg("accent", "⏵")} bash: `;
              const time = ` ${theme.fg("dim", age(Date.now() - j.start))}`;
              const room = Math.max(1, width - visibleWidth(head) - visibleWidth(time));
              return truncateToWidth(head + truncateToWidth(commandLine(j.command).trim(), room, "…") + time, width);
            });
            if (running.length > WIDGET_MAX) lines.push(truncateToWidth(theme.fg("dim", `  +${running.length - WIDGET_MAX} more · ctrl+shift+j`), width));
            return lines;
          },
          handleMouse(event: any) {
            if (event.type !== "click" || event.button !== "left" || !shown[event.y]) return undefined;
            void view(s.ui, shown[event.y]);
            return { handled: true };
          },
          invalidate() {},
        };
      },
      { placement: "aboveEditor" },
    );
  };
  const stop = () => {
    if (ticker) clearInterval(ticker);
    ticker = mounted = widgetTui = undefined;
  };
  return { refresh, stop };
}
