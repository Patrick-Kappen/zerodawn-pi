import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export const age = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
};

export const commandLine = (command: string, max?: number) => command.replace(/\s+/g, " ").slice(0, max);

export function absolutePath(path: string, cwd: string, { toolPath = true } = {}): string {
  const p = (toolPath ? path.replace(/^@/, "") : path).replace(/^~(?=\/|$)/, homedir());
  return isAbsolute(p) ? p : resolve(cwd, p);
}
