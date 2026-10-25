import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { inSession, uiTheme } from "../lib/theme.ts";
import { globalState } from "../lib/util.ts";

const KEY = "working";
const TRACK = 10;
const TAIL = 3;
const INTERVAL_MS = 70;
const LABEL_MAX = 50;

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

type State = {
  phase?: "thinking" | "writing";
  shown?: string;
  lit: boolean;
  frame: number;
  timer?: ReturnType<typeof setInterval>;
  tui?: TUI;
  ui?: ExtensionUIContext;
  thinkingLevel: () => ThinkingLevel;
};
const state = globalState<State>("ui.working.state", () => ({
  lit: false,
  frame: 0,
  thinkingLevel: () => {
    throw new Error("ui: working.ts asked for the thinking level before registerWorking set it.");
  },
}));

function label(s: State): string {
  const text = s.phase === "thinking" ? "Thinking…" : s.phase === "writing" ? "Writing…" : "Working…";
  return truncateToWidth(text, LABEL_MAX, "…");
}

function light(t: Theme, frame: number, track: (s: string) => string): string {
  const period = 2 * (TRACK - 1);
  const step = frame % period;
  const forward = step < TRACK - 1;
  const head = forward ? step : period - step;
  const cells = Array.from({ length: TRACK }, (_, cell) => {
    const behind = forward ? head - cell : cell - head;
    if (behind === 0) return t.bold(t.fg("accent", "━"));
    if (behind > 0 && behind < TAIL) return t.fg("accent", "━");
    if (behind === TAIL) return t.style("━", { fg: "accent", dim: true });
    return track("─");
  });
  return cells.reverse().join("");
}

function message(s: State): string {
  const text = label(s);
  if (!s.tui) return text;
  const t = uiTheme();
  const border = t.getThinkingBorderColor(s.thinkingLevel());
  const right = light(t, s.frame, border);
  const fill = s.tui.terminal.columns - 5 - visibleWidth(text) - visibleWidth(right) - 2;
  if (fill < 3) return text;
  return `${text} ${border("─".repeat(fill))} ${right}`;
}

function updateMessage(ui: ExtensionUIContext): void {
  const s = state();
  const next = message(s);
  if (next === s.shown) return;
  s.shown = next;
  ui.setWorkingMessage(next);
}

function setLit(lit: boolean): void {
  const s = state();
  if (s.lit === lit) return;
  s.lit = lit;
  if (lit) {
    s.timer = setInterval(() => {
      s.frame++;
      if (!inSession()) return;
      if (s.ui) updateMessage(s.ui);
      s.tui?.requestRender();
    }, INTERVAL_MS);
    s.timer.unref();
  } else {
    clearInterval(s.timer);
    s.timer = undefined;
  }
  s.tui?.requestRender();
}

export function registerWorking(pi: ExtensionAPI): void {
  state().thinkingLevel = () => pi.getThinkingLevel();

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setWidget(
      KEY,
      (tui) => {
        state().tui = tui;
        return { render: () => [], invalidate() {} };
      },
      { placement: "aboveEditor" },
    );
    ctx.ui.setWorkingIndicator({ frames: [] });
  });

  pi.on("agent_start", (_event, ctx) => {
    const s = state();
    s.phase = undefined;
    s.shown = undefined;
    s.ui = ctx.ui;
    updateMessage(ctx.ui);
    setLit(true);
  });

  pi.on("message_update", (event, ctx) => {
    const s = state();
    const type = event.assistantMessageEvent.type;
    if (type.startsWith("thinking")) s.phase = "thinking";
    else if (type.startsWith("text")) s.phase = "writing";
    else return;
    updateMessage(ctx.ui);
  });

  pi.on("tool_execution_start", (_event, ctx) => {
    state().phase = undefined;
    updateMessage(ctx.ui);
  });

  pi.on("agent_end", (_event, ctx) => {
    const s = state();
    s.shown = undefined;
    ctx.ui.setWorkingMessage();
    setLit(false);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    setLit(false);
    ctx.ui.setWidget(KEY, undefined, { placement: "aboveEditor" });
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingIndicator();
  });
}
