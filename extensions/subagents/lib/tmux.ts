import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export interface Window {
  id: string;
  name: string;
}

const SESSION_ID = /^[A-Za-z0-9-]{8,}$/;
const WINDOW_NAME = /^[A-Za-z0-9_-]+$/;
const ABSENT = /can't find session|no server running|error connecting/;

export function sessionName(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) {
    throw new Error(`subagents: pi session id "${sessionId}" is not usable as a tmux session name. Expected at least 8 characters of A-Z, a-z, 0-9 or "-".`);
  }
  return `pi-sub-${sessionId.slice(0, 8)}`;
}

export function createTmux(exec: Exec, socket?: string) {
  const base = socket === undefined ? [] : ["-L", socket];

  async function run(args: string[]): Promise<ExecResult> {
    const full = [...base, ...args];
    let result: ExecResult;
    try {
      result = await exec("tmux", full);
    } catch (cause) {
      throw new Error(`subagents: could not run "tmux ${full.join(" ")}". Make sure tmux is in PATH.`, { cause });
    }
    return result;
  }

  async function check(args: string[]): Promise<string> {
    const result = await run(args);
    if (result.code !== 0) {
      throw new Error(`subagents: "tmux ${[...base, ...args].join(" ")}" failed with exit code ${result.code}: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  async function hasSession(session: string): Promise<boolean> {
    const result = await run(["has-session", "-t", `=${session}`]);
    if (result.code === 0) return true;
    if (ABSENT.test(result.stderr)) return false;
    throw new Error(`subagents: "tmux has-session -t =${session}" failed with exit code ${result.code}: ${result.stderr.trim()}`);
  }

  async function openWindow(session: string, name: string, command: string[]): Promise<string> {
    if (!WINDOW_NAME.test(name)) {
      throw new Error(`subagents: window name "${name}" is not valid. Use only A-Z, a-z, 0-9, "_" or "-".`);
    }
    if (command.length === 0) throw new Error(`subagents: no command given for window "${name}".`);
    const format = ["-P", "-F", "#{window_id}", "-n", name];
    const args = (await hasSession(session))
      ? ["new-window", "-d", "-t", `=${session}:`, ...format, ...command]
      : ["new-session", "-d", "-s", session, ...format, ...command];
    return check(args);
  }

  async function listWindows(session: string): Promise<Window[]> {
    if (!(await hasSession(session))) return [];
    const out = await check(["list-windows", "-t", `=${session}`, "-F", "#{window_id}\t#{window_name}"]);
    return out.split("\n").map((line) => {
      const [id, name] = line.split("\t");
      if (id === undefined || name === undefined) {
        throw new Error(`subagents: unexpected line from "tmux list-windows": "${line}"`);
      }
      return { id, name };
    });
  }

  async function setOption(session: string, option: string, value: string): Promise<void> {
    await check(["set-option", "-t", `=${session}:`, option, value]);
  }

  async function getOption(session: string, option: string): Promise<string | undefined> {
    if (!(await hasSession(session))) return undefined;
    const value = await check(["show-options", "-qv", "-t", `=${session}:`, option]);
    return value === "" ? undefined : value;
  }

  async function killSession(session: string): Promise<void> {
    await check(["kill-session", "-t", `=${session}`]);
  }

  return { hasSession, openWindow, listWindows, setOption, getOption, killSession };
}

export type Tmux = ReturnType<typeof createTmux>;
