import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Layer } from "./hook.ts";

const UI = Symbol.for("tidy-ui.ui");
const globals = globalThis as unknown as Record<symbol, ExtensionUIContext | undefined>;

export function uiTheme(): Theme {
  const ui = globals[UI];
  if (!ui) throw new Error("tidy-ui: uiTheme() ran without a session. Wrap the hook layer in whenSession().");
  return ui.theme;
}

export function inSession(): boolean {
  return globals[UI] !== undefined;
}

export function whenSession(layer: Layer): Layer {
  return (self, next, args) => (inSession() ? layer(self, next, args) : next(...args));
}

export function registerTheme(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    globals[UI] = ctx.ui;
  });
  pi.on("session_shutdown", () => {
    globals[UI] = undefined;
  });
}
