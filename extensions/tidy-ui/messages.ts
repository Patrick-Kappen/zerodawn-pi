import { userInfo } from "node:os";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  InteractiveMode,
  keyText,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { hook, type Layer, unhook } from "./hook.ts";
import { uiTheme, whenSession } from "./theme.ts";
import { globalState } from "./util.ts";

const STYLES = ["row", "rule", "off"] as const;
type Style = (typeof STYLES)[number];
const STYLE_HELP: Record<Style, string> = {
  row: "● sender, then └ and the message, like a tool row",
  rule: "a rule with the sender above each message",
  off: "Pi's own rendering",
};
const INDENT = "  ";
const LINE_START = /^((?:\x1b\][^\x07]*\x07)*)((?:\x1b\[[0-9;]*m)*)( ?)/;
const KEY = "messages";

const PLAIN = Symbol.for("tidy-ui.messages.plain");
const ROW_MD = Symbol.for("tidy-ui.messages.rowMarkdown");
const ROW_STATUS = Symbol.for("tidy-ui.messages.rowStatus");

type State = { style: Style; flagApplied: boolean; agentHeaderNext: boolean; elbowNext: boolean };
type Look = { bgColor?: unknown; paddingY: number };
type MarkdownChild = {
  paddingY: number;
  defaultTextStyle?: { bgColor?: unknown };
  defaultStylePrefix?: string;
  invalidate(): void;
  [PLAIN]?: Look;
};
type UserRow = { children: MarkdownChild[] };
type AgentRow = { hiddenThinkingLabel: string };
type CustomRow = {
  message: { customType: string; content: string | Array<{ type: string; text?: string }> };
  customComponent?: unknown;
  markdownTheme: MarkdownTheme;
  [ROW_MD]?: { text: string; md: Markdown };
};
type SkillRow = {
  skillBlock: { name: string; content: string };
  expanded: boolean;
  markdownTheme: MarkdownTheme;
  [ROW_MD]?: { text: string; md: Markdown };
};
type StatusLine = { render(width: number): string[]; [ROW_STATUS]?: true };
type Interactive = { lastStatusText?: StatusLine };

const state = globalState<State>("tidy-ui.messages.state", () => ({ style: "row", flagApplied: false, agentHeaderNext: false, elbowNext: false }));

function isStyle(value: string): value is Style {
  return (STYLES as readonly string[]).includes(value);
}

const NAMES = { user: userInfo().username, agent: "pi" } as const;
type Sender = keyof typeof NAMES;

function header(sender: Sender, width: number, note = ""): string[] {
  const t = uiTheme();
  const name = NAMES[sender];
  if (state().style === "row") {
    const bullet = sender === "user" ? t.fg("accent", "●") : t.fg("success", "●");
    const title = sender === "user" ? t.fg("accent", t.bold(name)) : t.bold(name);
    return [` ${bullet} ${title}${note ? `  ${t.fg("thinkingText", t.italic(note))}` : ""}`];
  }
  const title = sender === "user" ? t.fg("accent", t.bold(name)) : t.fg("muted", t.bold(name));
  return [` ${t.fg("dim", "── ")}${title}${t.fg("dim", ` ${"─".repeat(Math.max(0, width - name.length - 6))}`)}`];
}

function plainText(line: string): string {
  return line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function renderBody(next: (width: number) => string[], width: number): string[] {
  return state().style === "row" ? next(width - INDENT.length) : next(width);
}

function withLead(line: string, lead: string): string {
  return line.replace(LINE_START, (_all, osc: string, sgr: string, pad: string) =>
    sgr && pad ? `${osc} ${lead.slice(0, -1)}${sgr}${pad}` : `${osc} ${lead}${sgr}`,
  );
}

function decorate(lines: string[]): string[] {
  const s = state();
  if (s.style !== "row") return lines;
  const elbow = `${uiTheme().fg("dim", "└")} `;
  return lines.map((line) => {
    const lead = s.elbowNext && plainText(line).trim() !== "" ? elbow : INDENT;
    if (lead === elbow) s.elbowNext = false;
    return withLead(line, lead);
  });
}

function elbowLines(lines: string[]): string[] {
  const elbow = `${uiTheme().fg("dim", "└")} `;
  let pending = true;
  return lines.map((line) => {
    const lead = pending && plainText(line).trim() !== "" ? elbow : INDENT;
    if (lead === elbow) pending = false;
    return withLead(line, lead);
  });
}

function minorHeader(name: string, note = ""): string {
  const t = uiTheme();
  return ` ${t.fg("dim", "●")} ${t.fg("customMessageLabel", t.bold(name))}${note ? ` ${note}` : ""}`;
}

function cachedMarkdown(row: { [ROW_MD]?: { text: string; md: Markdown } }, text: string, markdownTheme: MarkdownTheme): Markdown {
  if (row[ROW_MD]?.text !== text) {
    const color = (x: string) => uiTheme().fg("customMessageText", x);
    row[ROW_MD] = { text, md: new Markdown(text, 1, 0, markdownTheme, { color }) };
  }
  return (row[ROW_MD] as { md: Markdown }).md;
}

function liftThinking(lines: string[], label: string): { lines: string[]; lifted: boolean } {
  const index = lines.findIndex((line) => plainText(line).trim() !== "");
  if (index < 0 || plainText(lines[index]).trim() !== label) return { lines, lifted: false };
  let after = index + 1;
  while (after < lines.length && plainText(lines[after]).trim() === "") after++;
  return { lines: [...lines.slice(0, index), ...lines.slice(after)], lifted: true };
}

function setPlain(row: UserRow, on: boolean): void {
  const md = row.children[0];
  if (!md || (md[PLAIN] !== undefined) === on) return;
  if (on) {
    md[PLAIN] = { bgColor: md.defaultTextStyle?.bgColor, paddingY: md.paddingY };
    if (md.defaultTextStyle) md.defaultTextStyle = { ...md.defaultTextStyle, bgColor: undefined };
    md.paddingY = 0;
  } else {
    const look = md[PLAIN] as Look;
    if (md.defaultTextStyle) md.defaultTextStyle = { ...md.defaultTextStyle, bgColor: look.bgColor };
    md.paddingY = look.paddingY;
    delete md[PLAIN];
  }
  md.defaultStylePrefix = undefined;
  md.invalidate();
}

const HOOKS: Array<[object, string, Layer]> = [
  [
    UserMessageComponent.prototype,
    "render",
    (self: UserRow, next, [width]: [number]) => {
      const s = state();
      setPlain(self, s.style !== "off");
      if (s.style === "off") return next(width);
      s.agentHeaderNext = true;
      s.elbowNext = true;
      return [...header("user", width), ...decorate(renderBody(next, width))];
    },
  ],
  [
    AssistantMessageComponent.prototype,
    "render",
    (self: AgentRow, next, [width]: [number]) => {
      const s = state();
      if (s.style === "off") return next(width);
      const labeled = s.agentHeaderNext;
      let lines = renderBody(next, width);
      let note = "";
      if (labeled && s.style === "row") {
        const result = liftThinking(lines, self.hiddenThinkingLabel);
        lines = result.lines;
        if (result.lifted) note = self.hiddenThinkingLabel;
      }
      if (lines.length === 0 || !labeled) return decorate(lines);
      s.agentHeaderNext = false;
      s.elbowNext = true;
      lines = decorate(lines);
      const top = header("agent", width, note);
      return plainText(lines[0]).trim() === "" ? [lines[0], ...top, ...lines.slice(1)] : [...top, ...lines];
    },
  ],
  [ToolExecutionComponent.prototype, "render", (_self, next, [width]: [number]) => (state().style === "off" ? next(width) : decorate(renderBody(next, width)))],
  [
    CustomMessageComponent.prototype,
    "render",
    (self: CustomRow, next, [width]: [number]) => {
      if (state().style !== "row") return next(width);
      const own: string[] = next(width);
      if (own.length === 0) return own;
      if (self.customComponent) return own.map((line) => withLead(line, INDENT));
      const content = self.message.content;
      const text =
        typeof content === "string"
          ? content
          : content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");
      const md = cachedMarkdown(self, text, self.markdownTheme);
      return ["", minorHeader(self.message.customType), ...elbowLines(md.render(width - INDENT.length))];
    },
  ],
  [
    SkillInvocationMessageComponent.prototype,
    "render",
    (self: SkillRow, next, [width]: [number]) => {
      if (state().style !== "row") return next(width);
      const own = next(width);
      if (own.length === 0) return own;
      const t = uiTheme();
      const name = t.fg("customMessageText", self.skillBlock.name);
      if (!self.expanded) return [minorHeader("skill", `${name}${t.fg("dim", ` (${keyText("app.tools.expand")} to expand)`)}`)];
      const md = cachedMarkdown(self, self.skillBlock.content, self.markdownTheme);
      return [minorHeader("skill", name), ...elbowLines(md.render(width - INDENT.length))];
    },
  ],
  [
    InteractiveMode.prototype,
    "showStatus",
    (self: Interactive, next, [message]: [string]) => {
      next(message);
      const line = self.lastStatusText;
      if (!line || line[ROW_STATUS]) return;
      line[ROW_STATUS] = true;
      const render = line.render;
      line.render = function (this: unknown, width: number): string[] {
        if (state().style !== "row") return render.call(this, width);
        return render.call(this, width - INDENT.length).map((l) => withLead(l, INDENT));
      };
    },
  ],
];

export function registerMessages(pi: ExtensionAPI): void {
  for (const [proto, method, layer] of HOOKS) hook(proto, method, KEY, whenSession(layer));

  pi.registerFlag("messages", { type: "string", default: "row", description: `Message style: ${STYLES.join(", ")}` });

  pi.on("session_start", () => {
    const s = state();
    if (s.flagApplied) return;
    const flag = String(pi.getFlag("messages"));
    if (!isStyle(flag)) throw new Error(`tidy-ui: --messages "${flag}" is not valid. Use one of: ${STYLES.join(", ")}.`);
    s.style = flag;
    s.flagApplied = true;
  });

  pi.registerCommand("messages", {
    description: `Set the message style: /messages [${STYLES.join("|")}]`,
    getArgumentCompletions: (prefix) => STYLES.filter((s) => s.startsWith(prefix.trim())).map((s) => ({ value: s, label: s, description: STYLE_HELP[s] })),
    handler: async (args, ctx: ExtensionContext) => {
      const arg = args.trim();
      if (!isStyle(arg)) {
        ctx.ui.notify(`Unknown message style "${arg}". Use one of: ${STYLES.join(", ")}.`, "error");
        return;
      }
      state().style = arg;
      ctx.ui.setStatus(KEY, undefined);
    },
  });

  pi.on("session_shutdown", () => {
    for (const [proto, method] of HOOKS) unhook(proto, method, KEY);
  });
}
