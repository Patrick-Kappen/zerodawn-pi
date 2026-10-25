import { execFile } from "node:child_process";
import { readdirSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { config } from "../shared/config.ts";

const run = promisify(execFile);
const repoPath = config().nixosRepo;
const extensionsDir = join(homedir(), ".pi", "agent", "extensions");

function system(): string | undefined {
  try {
    return readlinkSync("/run/current-system");
  } catch {
    return undefined;
  }
}

function extensions(): string {
  try {
    return readdirSync(extensionsDir)
      .sort()
      .map((name) => {
        try {
          return `${name}=${realpathSync(join(extensionsDir, name))}`;
        } catch {
          return name;
        }
      })
      .join("\n");
  } catch {
    return "";
  }
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  return run("git", ["-C", cwd, ...args]).then(
    (r) => r.stdout.trim(),
    () => undefined,
  );
}

async function deployment(cwd: string): Promise<string | undefined> {
  if (!repoPath) return undefined;
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common !== join(repoPath, ".git")) return undefined;
  const { stdout } = await run("nixos-version", ["--json"]).catch(() => ({ stdout: "{}" }));
  const full = JSON.parse(stdout).configurationRevision as string | undefined;
  const dirty = full?.endsWith("-dirty") ?? false;
  const rev = full?.replace(/-dirty$/, "");
  if (!rev) return "Deployed revision unknown.";
  const short = rev.slice(0, 8);
  const note = dirty ? " Deployed from a dirty tree: uncommitted changes are live, but not in git." : "";
  const ahead = await git(cwd, ["rev-list", "--count", `${rev}..HEAD`]);
  if (ahead === undefined) return `Deployed: ${short}, not in this checkout.${note}`;
  return (ahead === "0" ? `Deployed: ${short} (HEAD).` : `Not deployed: HEAD is ${ahead} commit(s) ahead of deployed ${short}.`) + note;
}

export default function (pi: ExtensionAPI) {
  const loadedSystem = system();
  const loadedExtensions = extensions();

  const status = (ctx: ExtensionContext) => {
    const hints: string[] = [];
    if (system() !== loadedSystem) hints.push("system rebuilt");
    if (extensions() !== loadedExtensions) hints.push("extensions changed: /reload");
    ctx.ui.setStatus("system-state", hints.length ? ctx.ui.theme.fg("warning", hints.join(" · ")) : undefined);
  };

  pi.on("session_start", (_event, ctx) => status(ctx));
  pi.on("agent_end", (_event, ctx) => status(ctx));

  pi.on("before_agent_start", async (event, ctx) => {
    status(ctx);
    const current = system();
    if (current !== loadedSystem)
      event.systemPromptOptions.sections.system_state = `NixOS was rebuilt after this session started. Active system: ${current}. Session started on: ${loadedSystem}.`;
    else delete event.systemPromptOptions.sections.system_state;
    const line = await deployment(ctx.cwd);
    if (line) event.systemPromptOptions.sections.nixos_deployment = line;
    else delete event.systemPromptOptions.sections.nixos_deployment;
  });
}
