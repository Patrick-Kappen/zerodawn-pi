import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { frame, type Input, type Item, initial, type Outcome, render, type Scope, step } from "./model.ts";

export function toInput(data: string): Input | undefined {
  if (matchesKey(data, Key.up)) return { kind: "up" };
  if (matchesKey(data, Key.down)) return { kind: "down" };
  if (matchesKey(data, Key.tab)) return { kind: "tab" };
  if (matchesKey(data, Key.enter)) return { kind: "enter" };
  if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) return { kind: "escape" };
  if (matchesKey(data, Key.backspace)) return { kind: "backspace" };
  if (matchesKey(data, Key.ctrl("n"))) return { kind: "ctrl-n" };
  if (matchesKey(data, Key.ctrl("d"))) return { kind: "ctrl-d" };
  return /^[^\p{Cc}]+$/u.test(data) ? { kind: "text", text: data } : undefined;
}

export async function pick(ctx: ExtensionContext, items: Record<Scope, Item[]>): Promise<Outcome> {
  if (ctx.mode !== "tui" || !ctx.hasUI) throw new Error("/switch needs the pi TUI; start pi in interactive mode.");
  return ctx.ui.custom<Outcome>(
    (tui, theme, _keybindings, done) => {
      let state = initial(items);
      return {
        render: (width) =>
          frame(
            render(state).map((line, i) => (i === 0 ? theme.fg("accent", line) : line)),
            width,
            (border) => theme.fg("border", border),
          ),
        invalidate() {},
        handleInput(data) {
          const input = toInput(data);
          if (!input) return;
          const next = step(state, input);
          state = next.state;
          if (next.outcome) return done(next.outcome);
          tui.requestRender();
        },
      };
    },
    { overlay: true, overlayOptions: { anchor: "top-center", width: "80%", margin: { top: 2 } } },
  );
}
