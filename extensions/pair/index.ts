import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pairCommand, pairServer, type Run } from "../../shared/pair.ts";

export type Deps = {
  run: Run;
  spawnDetached: (command: string, args: string[]) => void;
  exists: (path: string) => boolean;
  cmdline: (pid: number) => string[];
  sleep: (ms: number) => Promise<void>;
  env: NodeJS.ProcessEnv;
  pid: number;
};

const quote = (text: string) => text.replaceAll("'", "''");

export const followExpr = (dir: string) => `luaeval('require("zerodawn.pair").follow(_A)', '${quote(dir)}')`;
export const startExpr = (dir: string) => `luaeval('(function(d) vim.cmd.cd(d); require("zerodawn.pair").start() end)(_A)', '${quote(dir)}')`;

async function remote(deps: Deps, server: string, expr: string, what: string) {
  const nvim = deps.env.PI_IDE_NVIM || "nvim";
  const result = await deps.run(nvim, ["--clean", "--headless", "--server", server, "--remote-expr", expr]);
  if (result.code !== 0)
    throw new Error(`/ide: ${what} failed on the nvim server ${server}: ${result.stderr.trim() || `exit ${result.code}`}. Start Neovide again with /ide.`);
  return result.stdout.trim();
}

// The nvim server can be a service that Neovide attaches to, so find the Neovide window whose command line names the socket.
async function focus(deps: Deps, server: string) {
  const clients = await deps.run("hyprctl", ["clients", "-j"]);
  if (clients.code !== 0) throw new Error(`/ide: hyprctl clients failed: ${clients.stderr.trim() || `exit ${clients.code}`}`);
  const windows = JSON.parse(clients.stdout) as { address: string; class: string; pid: number }[];
  const window = windows.find((w) => w.class === "neovide" && deps.cmdline(w.pid).includes(server));
  if (!window) throw new Error(`/ide: no Neovide window uses the nvim server ${server}.`);
  const result = await deps.run("hyprctl", ["dispatch", "focuswindow", `address:${window.address}`]);
  if (result.code !== 0 || result.stdout.trim() !== "ok")
    throw new Error(`/ide: hyprctl focuswindow address:${window.address} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
}

// Moves the paired Neovide to dir. Without a pair: starts Neovide on a socket, pairs this tmux client with it, and starts the pair there.
export async function ide(deps: Deps, pane: string | undefined, dir: string): Promise<string> {
  if (!pane) throw new Error("/ide: $TMUX_PANE is not set; start pi inside tmux.");
  const { client, server } = await pairServer(deps.run, pane);
  if (server) {
    await remote(deps, server, followExpr(dir), "following the worktree");
    await focus(deps, server);
    return `Neovide follows ${dir}`;
  }
  const socket = `${deps.env.XDG_RUNTIME_DIR || "/tmp"}/pi-ide-${deps.pid}.sock`;
  deps.spawnDetached(deps.env.PI_IDE_NEOVIDE || "neovide", ["--", "--listen", socket]);
  for (let i = 0; i < 50 && !deps.exists(socket); i++) await deps.sleep(100);
  if (!deps.exists(socket))
    throw new Error(`/ide: Neovide did not open ${socket} within 5 s. Check that ${deps.env.PI_IDE_NEOVIDE || "neovide"} starts, or set PI_IDE_NEOVIDE.`);
  if (!deps.env.PI_PAIR_COMMAND) {
    throw new Error("/ide: PI_PAIR_COMMAND is not set. Start pi again in a new tmux pane, or set it to the pair script of zerodawn-tmux.");
  }
  const { command, prefix } = pairCommand(deps.env);
  const registered = await deps.run(command, [...prefix, "register", client, socket]);
  if (registered.code !== 0) throw new Error(`/ide: pair register failed (exit ${registered.code}): ${registered.stderr.trim()}`);
  await remote(deps, socket, startExpr(dir), "starting the pair");
  return `Neovide started on ${dir}`;
}

export async function publishSession(run: Run, pane: string | undefined, sessionId: string) {
  if (!pane) return;
  const result = await run("tmux", ["set-option", "-p", "-t", pane, "@pair-agent-session", sessionId]);
  if (result.code !== 0) throw new Error(`pair: tmux set-option @pair-agent-session failed: ${result.stderr.trim()}`);
}

export default function (pi: ExtensionAPI) {
  const runner =
    (ctx: ExtensionContext): Run =>
    async (command, args) => {
      const r = await pi.exec(command, args, { cwd: ctx.cwd });
      return { code: r.code, stdout: r.stdout, stderr: r.stderr };
    };

  pi.on("session_start", async (_event, ctx) => {
    try {
      await publishSession(runner(ctx), process.env.TMUX_PANE, ctx.sessionManager.getSessionId());
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
    }
  });

  pi.registerCommand("ide", {
    description: "Open or focus the paired Neovide on this worktree, or start the pair",
    handler: async (_args, ctx) => {
      const deps: Deps = {
        run: runner(ctx),
        spawnDetached: (command, args) => {
          const child = spawn(command, args, { detached: true, stdio: "ignore", cwd: ctx.cwd });
          child.on("error", (error) => ctx.ui.notify(`/ide: cannot start ${command}: ${error.message}`, "error"));
          child.unref();
        },
        exists: existsSync,
        cmdline: (pid) => readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        env: process.env,
        pid: process.pid,
      };
      ctx.ui.notify(await ide(deps, process.env.TMUX_PANE, ctx.cwd), "info");
    },
  });
}
