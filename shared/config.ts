import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Config = { astGrep?: string; nixosRepo?: string };

export const CONFIG_FILE = fileURLToPath(new URL("../config.json", import.meta.url));

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function check(raw: unknown, file: string): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${file} is not a JSON object.`);
  const r = raw as Record<string, unknown>;
  for (const key of ["astGrep", "nixosRepo"] as const) {
    if (r[key] !== undefined && !isString(r[key])) throw new Error(`${file}: "${key}" must be a non-empty string.`);
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

let loaded: Config | undefined;

export function config(): Config {
  loaded ??= readConfig(CONFIG_FILE);
  return loaded;
}
