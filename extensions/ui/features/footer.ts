import { homedir } from "node:os";
import { basename } from "node:path";
import { type ExtensionAPI, type ExtensionContext, FooterComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { hook, unhook } from "../lib/hook.ts";
import { uiTheme, whenSession } from "../lib/theme.ts";
import { globalState, oneLine } from "../lib/util.ts";

const KEY = "footer";
const MODES = ["tidy", "pi"] as const;
type Mode = (typeof MODES)[number];
type State = { mode: Mode };

const LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Level = "off" | (typeof LEVELS)[number];
const MAIN_BRANCHES = new Set(["main", "master"]);

type Footer = {
  session: {
    state: { model?: { id: string; provider: string; reasoning?: boolean }; thinkingLevel?: string };
    sessionManager: { getCwd(): string; getSessionName(): string | undefined };
    routedModel?: { model: { id: string }; thinkingLevel?: string };
  };
  footerData: { getGitBranch(): string | null | undefined; getExtensionStatuses(): ReadonlyMap<string, string> };
  getSessionStats(): {
    usageTotals: { cost: number };
    contextUsage: { percent: number | null } | undefined;
  };
};

const state = globalState<State>("ui.footer.state", () => ({ mode: "tidy" }));

function isLevel(value: string): value is Level {
  return value === "off" || (LEVELS as readonly string[]).includes(value);
}

function thinkingBar(t: Theme, level: string): string {
  if (!isLevel(level)) throw new Error(`ui: unknown thinking level "${level}". Add it to LEVELS in footer.ts.`);
  const filled = LEVELS.indexOf(level as (typeof LEVELS)[number]) + 1;
  return t.fg("accent", "▰".repeat(filled)) + t.fg("dim", "▱".repeat(LEVELS.length - filled));
}

function render(self: Footer, width: number): string[] {
  const t = uiTheme();
  const dim = (s: string) => t.fg("dim", s);
  const { session, footerData } = self;
  const { usageTotals, contextUsage } = self.getSessionStats();
  const model = session.state.model;
  const room = width - 2;

  const branch = footerData.getGitBranch();
  const name = session.sessionManager.getSessionName();
  const percent = contextUsage?.percent;
  const color = (percent ?? 0) > 90 ? "error" : (percent ?? 0) > 70 ? "warning" : "dim";
  const facts = [
    dim("ctx ") + (percent === null || percent === undefined ? dim("?%") : t.fg(color, `${Math.round(percent)}%`)),
    ...(usageTotals.cost ? [dim(`$${usageTotals.cost.toFixed(2)}`)] : []),
  ].join(dim(" · "));
  const path = session.sessionManager.getCwd();
  const folder = path === homedir() ? "~" : basename(path);
  const branchText = branch && MAIN_BRANCHES.has(branch) ? t.style(branch, { fg: "error", dim: true }) : branch && t.fg("accent", branch);
  const where = `${dim(folder)}${branchText ? `   ${branchText}` : ""}${name ? dim(` · ${name}`) : ""}${dim(" · ")}${facts}`;

  const routed = session.routedModel;
  const level = routed?.thinkingLevel ?? session.state.thinkingLevel ?? "off";
  const id = routed ? `${model?.id ?? "?"} → ${routed.model.id}` : (model?.id ?? "no model");
  const right = truncateToWidth(model?.reasoning ? `${id} ${thinkingBar(t, level)}` : id, Math.max(0, room - 2), dim("…"));

  const left = truncateToWidth(where, Math.max(0, room - visibleWidth(right) - 2), dim("…"));
  const statuses = [...footerData.getExtensionStatuses().entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => `${dim("●")} ${oneLine(text, { ansi: true })}`)
    .join("   ");
  const middleRoom = room - visibleWidth(left) - visibleWidth(right) - 6;
  const middle = statuses && middleRoom > 0 ? `   ${truncateToWidth(statuses, middleRoom, dim("…"))}` : "";
  const gap = room - visibleWidth(left) - visibleWidth(middle) - visibleWidth(right);
  return [truncateToWidth(` ${left}${middle}${" ".repeat(Math.max(2, gap))}${right}`, width, "")];
}

export function registerFooter(pi: ExtensionAPI): void {
  hook(
    FooterComponent.prototype,
    "render",
    KEY,
    whenSession((self: Footer, next, [width]: [number]) => (state().mode === "pi" ? next(width) : render(self, width))),
  );

  pi.registerCommand("footer", {
    description: `Set the footer: /footer [${MODES.join("|")}]`,
    getArgumentCompletions: (prefix) =>
      MODES.filter((m) => m.startsWith(prefix.trim())).map((m) => ({
        value: m,
        label: m,
        description: m === "tidy" ? "simple footer, model and thinking bar at the bottom right" : "Pi's own footer",
      })),
    handler: async (args, ctx: ExtensionContext) => {
      const arg = args.trim();
      if (!(MODES as readonly string[]).includes(arg)) {
        ctx.ui.notify(`Unknown footer "${arg}". Use one of: ${MODES.join(", ")}.`, "error");
        return;
      }
      state().mode = arg as Mode;
      ctx.ui.setStatus(KEY, undefined);
    },
  });

  pi.on("session_shutdown", () => unhook(FooterComponent.prototype, "render", KEY));
}
