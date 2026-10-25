import { type ExtensionAPI, getLanguageFromPath, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme, visibleWidth } from "@earendil-works/pi-tui";
import { hook, unhook } from "./hook.ts";
import { uiTheme, whenSession } from "./theme.ts";

const CODE_THEME = Symbol.for("tidy-ui.code-blocks.codeTheme");
const FENCE = "\uE000tidy-ui-fence\uE000";
const KEY = "code-blocks";
const DIFF_LANGS = new Set(["diff", "patch"]);
const INDENT = "  ";

type Meta = { base: MarkdownTheme; by: typeof codeTheme; width: number };
type CodeTheme = MarkdownTheme & { [CODE_THEME]?: Meta };
type MarkdownRow = { theme: CodeTheme; paddingX: number; invalidate(): void };
type Kind = "add" | "del";
type Line = { text: string; bg?: Kind };

const TRUECOLOR_BG: Record<"dark" | "light", Record<Kind, [number, number, number]>> = {
  dark: { add: [18, 38, 30], del: [37, 23, 28] },
  light: { add: [230, 255, 236], del: [255, 235, 233] },
};
const TOKEN_BG = { add: "toolSuccessBg", del: "toolErrorBg" } as const;

function highlight(base: MarkdownTheme, code: string, lang: string | undefined): string[] {
  return lang && base.highlightCode ? base.highlightCode(code, lang) : code.split("\n");
}

function diffLines(base: MarkdownTheme, code: string): Line[] {
  const t = uiTheme();
  const file = code.match(/^\+\+\+ (?:b\/)?(\S+)/m)?.[1];
  const lang = file?.endsWith(".nix") ? "nix" : file ? getLanguageFromPath(file) : undefined;
  return code.split("\n").map((raw): Line => {
    if (/^(diff |index |--- |\+\+\+ )/.test(raw)) return { text: t.fg("dim", raw) };
    if (raw.startsWith("@@")) return { text: t.fg("accent", raw) };
    const sign = raw[0];
    const body = highlight(base, raw.slice(1), lang)[0] ?? "";
    if (sign === "+") return { text: t.fg("toolDiffAdded", "+") + body, bg: "add" };
    if (sign === "-") return { text: t.fg("toolDiffRemoved", "-") + body, bg: "del" };
    return { text: ` ${body}` };
  });
}

function diffRows(lines: Line[], maxWidth: number): string[] {
  const t = uiTheme();
  const inner = Math.min(Math.max(...lines.map((l) => visibleWidth(l.text))), maxWidth - 1);
  return lines.map((l) => (l.bg ? paint(t, l.bg, `${l.text}${" ".repeat(Math.max(0, inner - visibleWidth(l.text)))} `) : l.text));
}

function paint(t: Theme, kind: Kind, text: string): string {
  if (t.getColorMode() !== "truecolor") return t.bg(TOKEN_BG[kind], text);
  const [r, g, b] = TRUECOLOR_BG[t.appearance][kind];
  const bg = `\x1b[48;2;${r};${g};${b}m`;
  return `${bg}${text.replace(/\x1b\[(0|49)?m/g, (reset) => reset + bg)}\x1b[49m`;
}

function codeTheme(base: MarkdownTheme): CodeTheme {
  const meta: Meta = { base, by: codeTheme, width: 0 };
  return {
    ...base,
    [CODE_THEME]: meta,
    codeBlockBorder: () => FENCE,
    highlightCode: (code, lang) => {
      const text = code.replace(/\t/g, "    ");
      return lang && DIFF_LANGS.has(lang) ? diffRows(diffLines(base, text), meta.width) : highlight(base, text, lang);
    },
  };
}

function render(self: MarkdownRow, next: (width: number) => string[], [width]: [number]): string[] {
  const wrapped = self.theme[CODE_THEME];
  if (wrapped?.by !== codeTheme) {
    self.theme = codeTheme(wrapped?.base ?? self.theme);
    self.invalidate();
  }
  const meta = self.theme[CODE_THEME] as Meta;
  const available = width - 2 * self.paddingX - INDENT.length;
  if (meta.width !== available) {
    meta.width = available;
    self.invalidate();
  }
  return next(width).filter((line) => !line.includes(FENCE));
}

export function registerCodeBlocks(pi: ExtensionAPI): void {
  hook(Markdown.prototype, "render", KEY, whenSession(render));
  pi.on("session_shutdown", () => unhook(Markdown.prototype, "render", KEY));
}
