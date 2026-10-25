import {
  AssistantMessageComponent,
  CustomMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  InteractiveMode,
  SkillInvocationMessageComponent,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { argSummary } from "../shared/util.ts";
import { hook, type Layer, unhook } from "./hook.ts";
import { uiTheme, whenSession } from "./theme.ts";
import { globalState } from "./util.ts";

const MODES = ["normal", "compact", "text", "silent"] as const;
type Mode = (typeof MODES)[number];
const MODE_HELP: Record<Mode, string> = {
  normal: "Pi's own rendering",
  compact: "tool calls as two lines",
  text: "no tool calls or thinking, text stays",
  silent: "only the final answer",
};
const SHORTCUT = "alt+o";

const RENDERED_MODE = Symbol.for("tidy-ui.views.renderedMode");
const RETRIED = Symbol.for("tidy-ui.views.retried");
const STATUS_MESSAGE = Symbol.for("tidy-ui.views.statusMessage");
const KEY = "views";

const NOISE_STATUS = [/^Reloaded /, /^(Default )?Thinking level: /, /^Thinking blocks: /, /^Tool output: /, /^(Default )?Model: /, /^Switched to /];

type RenderFn = (width: number) => string[];
type Content = { type: string; text?: string };
type Message = { content: Content[]; stopReason?: string; errorMessage?: string };
type UpdateFn = (message: Message, isStreaming?: boolean) => void;
type State = { mode: Mode; flagApplied: boolean; lastError?: AssistantRow };
type StatusLine = { render: RenderFn; [STATUS_MESSAGE]?: string };
type Interactive = { lastStatusText?: StatusLine; lastStatusSpacer?: StatusLine };

type ToolRow = {
  toolName: string;
  args: unknown;
  expanded: boolean;
  isPartial: boolean;
  result?: { content: Content[]; isError: boolean };
};
type AssistantRow = {
  lastMessage?: Message;
  isStreaming: boolean;
  [RENDERED_MODE]?: Mode;
  [RETRIED]?: boolean;
  updateContent: UpdateFn;
};

const state = globalState<State>("tidy-ui.views.state", () => ({ mode: "normal", flagApplied: false }));

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

function compactLines(row: ToolRow, width: number, theme: Theme): string[] {
  const summary = argSummary(row.args);
  const call = theme.fg("toolTitle", theme.bold(row.toolName)) + (summary ? ` ${theme.fg("accent", summary)}` : "");
  let outcome: string;
  if (row.isPartial || !row.result) {
    outcome = theme.fg("muted", "running…");
  } else {
    const text = row.result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    const lines = text ? text.split("\n") : [];
    const images = row.result.content.filter((c) => c.type === "image").length;
    const body = lines.length > 0 ? lines[0].trim() + (lines.length > 1 ? ` (+${lines.length - 1} lines)` : "") : images > 0 ? `${images} image(s)` : "done";
    outcome = theme.fg(row.result.isError ? "error" : "dim", body);
  }
  return [truncateToWidth(` ${call}`, width), truncateToWidth(`   ⎿ ${outcome}`, width)];
}

function visibleMessage(message: Message, streaming: boolean, retried: boolean): Message {
  const mode = state().mode;
  if (mode === "normal" || mode === "compact") return message;
  if (retried) return { ...message, content: [], stopReason: "stop", errorMessage: undefined };
  const hideText = mode === "silent" && (streaming || message.content.some((c) => c.type === "toolCall"));
  const content = message.content.filter((c) => c.type !== "thinking" && !(hideText && c.type === "text"));
  return { ...message, content };
}

function trackRetry(row: AssistantRow, message: Message): void {
  const s = state();
  if (message.stopReason === "error") {
    s.lastError = row;
    return;
  }
  const failed = s.lastError;
  if (!failed || failed === row || !failed.lastMessage) return;
  s.lastError = undefined;
  failed[RETRIED] = true;
  failed.updateContent(failed.lastMessage);
}

const HOOKS: Array<[object, string, Layer]> = [
  [
    ToolExecutionComponent.prototype,
    "render",
    (self: ToolRow, next, [width]: [number]) => {
      const { mode } = state();
      if (mode === "normal" || (mode === "compact" && self.expanded)) return next(width);
      if (mode === "compact") return compactLines(self, width, uiTheme());
      return [];
    },
  ],
  [
    AssistantMessageComponent.prototype,
    "updateContent",
    (self: AssistantRow, next, [message, isStreaming]: [Message, boolean | undefined]) => {
      const streaming = isStreaming ?? self.isStreaming;
      next(visibleMessage(message, streaming, self[RETRIED] === true), streaming);
      self.lastMessage = message;
      self[RENDERED_MODE] = state().mode;
      trackRetry(self, message);
    },
  ],
  [
    AssistantMessageComponent.prototype,
    "render",
    (self: AssistantRow, next, [width]: [number]) => {
      if (self.lastMessage && self[RENDERED_MODE] !== state().mode) self.updateContent(self.lastMessage);
      return next(width);
    },
  ],
  [CustomMessageComponent.prototype, "render", (_self, next, [width]: [number]) => (quiet() ? [] : next(width))],
  [SkillInvocationMessageComponent.prototype, "render", (_self, next, [width]: [number]) => (quiet() ? [] : next(width))],
  [
    InteractiveMode.prototype,
    "showStatus",
    (self: Interactive, next, [message]: [string]) => {
      next(message);
      for (const line of [self.lastStatusText, self.lastStatusSpacer]) {
        if (!line) continue;
        if (line[STATUS_MESSAGE] === undefined) {
          const render = line.render;
          line.render = function (this: StatusLine, width: number): string[] {
            return quiet() && isNoise(this[STATUS_MESSAGE]) ? [] : render.call(this, width);
          };
        }
        line[STATUS_MESSAGE] = message;
      }
    },
  ],
];

function quiet(): boolean {
  const { mode } = state();
  return mode === "text" || mode === "silent";
}

function isNoise(message: string | undefined): boolean {
  return message !== undefined && NOISE_STATUS.some((pattern) => pattern.test(message));
}

export function registerViews(pi: ExtensionAPI): void {
  for (const [proto, method, layer] of HOOKS) hook(proto, method, KEY, whenSession(layer));

  pi.registerFlag("view", { type: "string", default: "normal", description: `Start view mode: ${MODES.join(", ")}` });

  pi.on("session_start", () => {
    const s = state();
    if (!s.flagApplied) {
      const flag = String(pi.getFlag("view"));
      if (!isMode(flag)) throw new Error(`tidy-ui: --view "${flag}" is not valid. Use one of: ${MODES.join(", ")}.`);
      s.mode = flag;
      s.flagApplied = true;
    }
  });

  const setMode = (mode: Mode, ctx: ExtensionContext) => {
    state().mode = mode;
    ctx.ui.setStatus(KEY, undefined);
  };
  const nextMode = () => MODES[(MODES.indexOf(state().mode) + 1) % MODES.length];

  pi.registerCommand("view", {
    description: `Set the transcript view: /view [${MODES.join("|")}]. No argument selects the next mode (${SHORTCUT}).`,
    getArgumentCompletions: (prefix) => MODES.filter((m) => m.startsWith(prefix.trim())).map((m) => ({ value: m, label: m, description: MODE_HELP[m] })),
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "") setMode(nextMode(), ctx);
      else if (isMode(arg)) setMode(arg, ctx);
      else ctx.ui.notify(`Unknown view "${arg}". Use one of: ${MODES.join(", ")}.`, "error");
    },
  });

  pi.registerShortcut(SHORTCUT, {
    description: "Select the next transcript view",
    handler: (ctx) => setMode(nextMode(), ctx),
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "user") state().lastError = undefined;
  });

  pi.on("session_shutdown", () => {
    for (const [proto, method] of HOOKS) unhook(proto, method, KEY);
  });
}
