import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Config = { astGrep?: string; nixosRepo?: string };

export const CONFIG_FILE = fileURLToPath(new URL("../config.json", import.meta.url));

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function check(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} is not a JSON object.`);
  const r = raw as Record<string, unknown>;
  for (const key of ["astGrep", "nixosRepo"] as const) {
    if (r[key] !== undefined && !isString(r[key])) throw new Error(`${CONFIG_FILE}: "${key}" must be a non-empty string.`);
  }
  return r as Config;
}

let loaded: Config | undefined;

export function config(): Config {
  if (loaded) return loaded;
  let text: string;
  try {
    text = readFileSync(CONFIG_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    loaded = {};
    return loaded;
  }
  try {
    loaded = check(JSON.parse(text));
  } catch (err) {
    throw new Error(`zerodawn-pi: cannot read ${CONFIG_FILE}: ${(err as Error).message} See config.example.json.`, { cause: err });
  }
  return loaded;
}
