const TOOL_ICONS: Record<string, string> = {
  bash: "\ue795",
  read: "\u{f0214}",
  edit: "\u{f03eb}",
  write: "\u{f0752}",
  grep: "\u{f0349}",
  ast_grep: "\u{f0349}",
  git: "\ue725",
  codemode: "\u{f0626}",
  fork: "\uf126",
  opencode: "\uf126",
  jobs: "\u{f046e}",
  tool_search: "\u{f0349}",
};

export const ICON_MCP = "\uf1e6";
export const ICON_DEFAULT = "\uf0ad";
export const ICON_HEADER = "\uf085";

export const STATUS = { running: "●", done: "✓", failed: "✗", killed: "■", background: "⇡" } as const;

export function toolIcon(name: string): string {
  if (name.startsWith("mcp__")) return ICON_MCP;
  return TOOL_ICONS[name] ?? ICON_DEFAULT;
}
