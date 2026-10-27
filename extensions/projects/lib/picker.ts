import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { runCustomInteraction } from "@narumitw/pi-tui-kit";
import { type Input, type Item, initial, type Outcome, render, type Scope, step } from "./model.ts";

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
  const result = await runCustomInteraction<Outcome, ExtensionContext>(ctx, {
    create: ({ theme, complete }) => {
      let state = initial(items);
      return {
        render: (width) => render(state).map((line, i) => truncateToWidth(i === 0 ? theme.fg("accent", line) : line, width)),
        invalidate() {},
        handleInput(data) {
          const input = toInput(data);
          if (!input) return;
          const next = step(state, input);
          state = next.state;
          if (next.outcome) complete(next.outcome);
        },
      };
    },
    onUnsupportedMode: (c) => c.ui.notify("/switch needs the pi TUI.", "warning"),
    onError: (c, error) => c.ui.notify(`/switch: ${error instanceof Error ? error.message : String(error)}`, "error"),
  });
  return result.kind === "completed" ? result.value : { kind: "cancel" };
}
