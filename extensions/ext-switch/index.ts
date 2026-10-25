import { type ExtensionAPI, type ExtensionCommandContext, getAgentDir, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type Env, findRow, loadRows, type Row, refOf, type Scope, settingsPath, toggle } from "./settings.ts";

const USAGE = "Usage: /ext | /ext list | /ext on <name> [--project] | /ext off <name> [--project]";

const environment = (ctx: ExtensionCommandContext): Env => ({ agentDir: getAgentDir(), cwd: ctx.cwd, selfDir: import.meta.dirname });
const stateText = (r: Row) => `${r.enabled ? "on" : "off"} · ${r.scope}`;

function describeRows(rows: Row[]): string {
  const lines: string[] = [];
  let group = "";
  for (const r of rows) {
    if (r.group !== group) lines.push(`${group ? "\n" : ""}${r.group}`);
    group = r.group;
    lines.push(`  ${r.name}  ${stateText(r)}`);
  }
  return lines.join("\n");
}

async function openList(ctx: ExtensionCommandContext, env: Env): Promise<boolean> {
  let state = loadRows(env);
  let changed = false;
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    let target: Scope = "user";
    let message = "";
    const root = new Container();
    const header = {
      render: () => [
        theme.fg("accent", theme.bold("Extensions and resources")),
        theme.fg("muted", `Write to: ${target} (${settingsPath(target, env)})`),
        theme.fg("dim", "enter/click toggle · tab switch scope · type to search · esc close"),
        "",
      ],
      invalidate() {},
    };
    const footer = {
      render: (width: number) => (message ? ["", ...wrapTextWithAnsi(theme.fg("error", message), width)] : []),
      invalidate() {},
    };

    const build = (selected?: string) => {
      const items: SettingItem[] = state.rows.map((r, i) => ({
        id: String(i),
        label: `${r.group} › ${r.name}`,
        currentValue: stateText(r),
        values: [stateText(r), `${r.enabled ? "off" : "on"} · ${target}`],
      }));
      const settingsList = new SettingsList(
        items,
        Math.min(items.length, 15),
        getSettingsListTheme(),
        (id) => {
          try {
            toggle(env, state.rows[Number(id)], target, !state.rows[Number(id)].enabled);
            changed = true;
            message = "";
            state = loadRows(env);
          } catch (e) {
            message = e instanceof Error ? e.message : String(e);
          }
          show(id);
        },
        () => done(undefined),
        { enableSearch: true },
      );
      if (selected !== undefined) settingsList.selectItem(selected);
      return settingsList;
    };
    const show = (selected?: string) => {
      root.clear();
      list = build(selected);
      root.addChild(header);
      root.addChild(list);
      root.addChild(footer);
      tui.requestRender();
    };
    let list = build();
    root.addChild(header);
    root.addChild(list);
    root.addChild(footer);

    return Object.assign(root, {
      handleInput(data: string) {
        if (matchesKey(data, Key.tab)) {
          target = target === "user" ? "project" : "user";
          show();
          return;
        }
        list.handleInput(data);
        tui.requestRender();
      },
    });
  });
  return changed;
}

function parseArgs(args: string): { verb: string; name: string; scope: Scope } {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const scope: Scope = words.includes("--project") ? "project" : "user";
  const [verb = "", ...rest] = words.filter((w) => w !== "--project");
  return { verb, name: rest.join(" "), scope };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ext", {
    description: "Enable or disable extensions, skills, prompts and themes, then reload",
    getArgumentCompletions: (prefix) => ["list", "on", "off"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
    handler: async (args, ctx) => {
      const env = environment(ctx);
      const { verb, name, scope } = parseArgs(args);

      if (verb === "") {
        if (ctx.mode !== "tui") throw new Error(`/ext without arguments needs the TUI. ${USAGE}`);
        if (await openList(ctx, env)) await ctx.reload();
        return;
      }
      if (verb === "list") {
        const { rows, skipped } = loadRows(env);
        ctx.ui.notify([describeRows(rows), ...skipped].join("\n\n"), "info");
        return;
      }
      if (verb !== "on" && verb !== "off") throw new Error(`Unknown argument "${verb}". ${USAGE}`);
      if (!name) throw new Error(`/ext ${verb} needs a name. Run "/ext list" to see the names.`);

      const row = findRow(loadRows(env).rows, name);
      const enabled = verb === "on";
      if (row.enabled === enabled) {
        ctx.ui.notify(`${refOf(row)} is already ${verb} (${row.scope}).`, "info");
        return;
      }
      toggle(env, row, scope, enabled);
      ctx.ui.notify(`${refOf(row)} is ${verb} in ${scope} settings. Reloading.`, "info");
      await ctx.reload();
    },
  });
}
