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

export function textOf(content: { type: string; text?: string }[]): string | undefined {
  if (!content.every((c) => c.type === "text")) return undefined;
  return content.map((c) => c.text ?? "").join("");
}

export function stripQuoted(command: string): string {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "<<H$3")
    .replace(/'[^']*'/g, "Q")
    .replace(/"(?:[^"\\]|\\.)*"/g, "Q");
}

const ARG_KEYS = ["command", "path", "file_path", "pattern", "query", "url", "task", "code", "action"];

export function argSummary(args: unknown, max?: number): string {
  if (args === null || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const key = ARG_KEYS.find((k) => typeof record[k] === "string");
  const raw = commandLine(key ? (record[key] as string) : JSON.stringify(record), max).trim();
  return raw.startsWith(`${homedir()}/`) ? `~${raw.slice(homedir().length)}` : raw;
}
