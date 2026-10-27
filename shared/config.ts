import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Config = { astGrep?: string; nixosRepo?: string; subagentExtensions?: string[]; nvim?: string; treesitterParsers?: string };

export const CONFIG_FILE = fileURLToPath(new URL("../config.json", import.meta.url));

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function check(raw: unknown, file: string): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${file} is not a JSON object.`);
  const r = raw as Record<string, unknown>;
  for (const key of ["astGrep", "nixosRepo", "nvim", "treesitterParsers"] as const) {
    if (r[key] !== undefined && !isString(r[key])) throw new Error(`${file}: "${key}" must be a non-empty string.`);
  }
  const list = r.subagentExtensions;
  if (list !== undefined && !(Array.isArray(list) && list.every((p) => isString(p) && p.startsWith("/")))) {
    throw new Error(`${file}: "subagentExtensions" must be an array of absolute paths.`);
  }
  return r as Config;
}

export function readConfig(file: string): Config {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return {};
  }
  try {
    return check(JSON.parse(text), file);
  } catch (err) {
    throw new Error(`zerodawn-pi: cannot read ${file}: ${(err as Error).message} See config.example.json.`, { cause: err });
  }
}

export const CONFIG_ENV = "ZERODAWN_PI_CONFIG";

// The dev sandbox runs the worktree code with the config of the installed package.
export function configFile(env: NodeJS.ProcessEnv = process.env): string {
  const value = env[CONFIG_ENV];
  if (value === undefined) return CONFIG_FILE;
  if (!value.startsWith("/")) throw new Error(`zerodawn-pi: ${CONFIG_ENV} must be an absolute path, got "${value}".`);
  return value;
}

let loaded: Config | undefined;

export function config(): Config {
  loaded ??= readConfig(configFile());
  return loaded;
}

export function handoffModels(file: string = configFile()): string[] {
  const list = (readConfig(file) as { handoffModels?: unknown }).handoffModels;
  if (!Array.isArray(list) || list.length === 0 || !list.every(isString)) {
    throw new Error(
      `zerodawn-pi: ${file} needs "handoffModels", a non-empty list of "provider/id[:thinking]" strings. Set programs.zerodawn-pi.handoffModels or see config.example.json.`,
    );
  }
  return list;
}

export function subagentModels(file: string = configFile()): string[] {
  const list = (readConfig(file) as { subagentModels?: unknown }).subagentModels;
  if (!Array.isArray(list) || list.length === 0 || !list.every(isString)) {
    throw new Error(
      `zerodawn-pi: ${file} needs "subagentModels", a non-empty list of "provider/id[:thinking]" strings. Set programs.zerodawn-pi.subagentModels or see config.example.json.`,
    );
  }
  return list;
}
