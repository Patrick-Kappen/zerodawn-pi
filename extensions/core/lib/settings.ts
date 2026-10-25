/*
 * What `pi config` writes to settings.json (pi 1.3.0, found by running it in a scratch agent dir).
 *
 * Arrays: `extensions`, `skills`, `prompts`, `themes`. An entry is `+<path>` (on), `-<path>` (off)
 * or `!<glob>` (exclude). A plain entry is an extra path to load. Toggling one resource removes its
 * old `+`, `-` and `!<exact path>` entries and appends one new `+` or `-` entry, even for the
 * default state: `"extensions": ["-extensions/loose.ts", "+builtin:tool-search"]`.
 * Pi writes JSON with 2-space indentation and no final newline.
 *
 * Built-in extension: entry `builtin:<name>` (codemode, llama.cpp, mcp, tool-search). On by default.
 * User scope and project scope use the same entries.
 *
 * Paths. User scope resolves from the agent directory, project scope from `<cwd>/.pi`. A resource
 * of the same scope uses a relative path (`extensions/loose.ts`, `skills/dummy/SKILL.md`; a skill
 * is the SKILL.md file). A user resource set in project scope uses its absolute path, and pi adds
 * the plain absolute path before the signed one: `["/a/SKILL.md", "-/a/SKILL.md"]`.
 *
 * Packages. `packages` holds a string or `{ source, extensions?, skills?, prompts?, themes?, autoload? }`.
 * The filter paths are relative to the package root (`-extensions/bash/index.ts`). Pi converts a string
 * to an object on the first toggle. A missing filter key loads everything. `[]` loads nothing.
 * A list with only `+`, `-` and `!` entries loads everything except the `-` and `!` matches.
 * A list with plain entries (`prompts/*.md`) loads only the matches.
 * In project scope, pi adds a delta entry: `{ "source": "<path relative to .pi>", "autoload": false,
 * "extensions": ["-x.ts"] }`. A project entry without `autoload: false` replaces the user entry.
 *
 * Project scope cycles inherit, `-`, `+`, inherit. Inherit removes the signed entry and, for a
 * user resource, the plain one too. This module sets `+` or `-` and never inherits.
 *
 * Run time list. Pi has no extension API for loaded resources: `pi.getCommands()` has only skills,
 * prompts and commands, and no themes or silent extensions. So this module reads the directories
 * and package manifests itself, as `pi config` does.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type Scope = "user" | "project";
export type Kind = "builtin" | "extension" | "skill" | "prompt" | "theme";
export type Settings = Record<string, unknown>;

export interface Env {
  agentDir: string;
  cwd: string;
  /** Directory of this extension. Its resources cannot be disabled. */
  selfDir?: string;
}

export interface Resource {
  kind: Kind;
  group: string;
  name: string;
  /** "builtin", "user", "project", or the package label. Tells equal names apart. */
  origin: string;
  /** Absolute file path. For a built-in: `builtin:<name>`. */
  path: string;
  /** Scope of the directory or settings file that holds the resource. */
  home: Scope | "builtin";
  /** Package identity and root, for package resources. */
  pkg?: { identity: string; root: string };
  protected: boolean;
}

export interface Row extends Resource {
  enabled: boolean;
  /** The scope that sets the state. */
  scope: Scope | "default";
}

const BUILTINS = ["codemode", "llama.cpp", "mcp", "tool-search"];
const KINDS: Exclude<Kind, "builtin">[] = ["extension", "skill", "prompt", "theme"];
const KEY: Record<Exclude<Kind, "builtin">, string> = { extension: "extensions", skill: "skills", prompt: "prompts", theme: "themes" };
const FILE: Record<Exclude<Kind, "builtin">, RegExp> = { extension: /\.(ts|js)$/, skill: /\.md$/, prompt: /\.md$/, theme: /\.json$/ };
const GROUP: Record<Exclude<Kind, "builtin" | "extension">, string> = { skill: "Skills", prompt: "Prompts", theme: "Themes" };

const posix = (p: string) => p.split(sep).join("/");
const expandHome = (p: string) => p.replace(/^~(?=\/|$)/, homedir());
const typeOf = (p: string) => {
  const s = statSync(p, { throwIfNoEntry: false });
  return s ? (s.isDirectory() ? "dir" : "file") : undefined;
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function settingsPath(scope: Scope, env: Env): string {
  return scope === "user" ? join(env.agentDir, "settings.json") : join(env.cwd, ".pi", "settings.json");
}
const baseDir = (scope: Scope, env: Env) => (scope === "user" ? env.agentDir : join(env.cwd, ".pi"));

export function readSettings(scope: Scope, env: Env): Settings {
  const path = settingsPath(scope, env);
  if (scope === "user" && typeOf(env.agentDir) !== "dir") {
    throw new Error(`Agent directory ${env.agentDir} does not exist. Create it or set PI_CODING_AGENT_DIR to an existing directory.`);
  }
  if (!existsSync(path)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`Cannot read settings ${path}: ${errorText(cause)}. Fix the file by hand, then run the command again.`, { cause });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Settings ${path} is not a JSON object. Fix the file by hand, then run the command again.`);
  }
  return value as Settings;
}

export function writeSettings(scope: Scope, env: Env, settings: Settings): void {
  const path = settingsPath(scope, env);
  // Keep a symlinked settings.json a symlink: write the file it points to.
  const target = existsSync(path) ? realpathSync(path) : path;
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(tmp, JSON.stringify(settings, null, 2));
    renameSync(tmp, target);
  } catch (cause) {
    rmSync(tmp, { force: true });
    throw new Error(`Cannot write settings ${target}: ${errorText(cause)}. Make sure the directory is writable, then run the command again.`, { cause });
  }
}

function list(settings: Settings, key: string, path: string): string[] {
  const value = settings[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((e) => typeof e !== "string")) {
    throw new Error(`Setting "${key}" in ${path} is not a list of strings. Fix the file by hand.`);
  }
  return value as string[];
}

interface PackageEntry {
  source: string;
  [key: string]: unknown;
}

function packageEntries(settings: Settings, path: string): PackageEntry[] {
  const value = settings.packages;
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Setting "packages" in ${path} is not a list. Fix the file by hand.`);
  return value.map((e) => {
    if (typeof e === "string") return { source: e };
    if (typeof e === "object" && e !== null && typeof (e as PackageEntry).source === "string") return e as PackageEntry;
    throw new Error(`An entry of "packages" in ${path} has no source. Fix the file by hand.`);
  });
}

const isLocal = (source: string) => /^(\/|\.\.?(\/|$)|~(\/|$))/.test(source);
const identityOf = (source: string, base: string) => (isLocal(source) ? resolve(base, expandHome(source)) : source);

function findPackage(settings: Settings, scope: Scope, env: Env, identity: string): { index: number; entry: PackageEntry } | undefined {
  const entries = packageEntries(settings, settingsPath(scope, env));
  const index = entries.findIndex((e) => identityOf(e.source, baseDir(scope, env)) === identity);
  return index < 0 ? undefined : { index, entry: entries[index] };
}

// ---- Discovery

const globRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\0/g, ".*")
      .replace(/\?/g, "[^/]")}$`,
  );

function ownFile(kind: Exclude<Kind, "builtin">, dir: string): string | undefined {
  const names = kind === "extension" ? ["index.ts", "index.js"] : kind === "skill" ? ["SKILL.md"] : [];
  return names.map((n) => join(dir, n)).find((p) => typeOf(p) === "file");
}

/** Resource files that a file or directory stands for. */
function resolveEntry(kind: Exclude<Kind, "builtin">, path: string): string[] {
  const type = typeOf(path);
  if (type === "file") return FILE[kind].test(path) ? [path] : [];
  if (type !== "dir") return [];
  const own = ownFile(kind, path);
  if (own) return [own];
  return readdirSync(path)
    .sort()
    .flatMap((name) => {
      const child = join(path, name);
      if (typeOf(child) === "dir") return ownFile(kind, child) ?? [];
      return FILE[kind].test(name) ? [child] : [];
    });
}

function expandGlob(root: string, pattern: string): string[] {
  const segments = pattern.replace(/^\.\//, "").split("/").filter(Boolean);
  const walk = (dir: string, i: number): string[] => {
    if (i === segments.length) return [dir];
    if (typeOf(dir) !== "dir") return [];
    const segment = segments[i];
    const children = readdirSync(dir).sort();
    if (segment === "**") {
      const deeper = children.filter((n) => n !== "node_modules" && n !== ".git").flatMap((n) => walk(join(dir, n), i));
      return [...walk(dir, i + 1), ...deeper];
    }
    const re = globRegExp(segment);
    return children.filter((n) => re.test(n)).flatMap((n) => walk(join(dir, n), i + 1));
  };
  return walk(root, 0);
}

function manifestList(manifest: Record<string, unknown> | undefined, key: string, file: string): string[] {
  const value = manifest?.[key] ?? [key];
  if (!Array.isArray(value) || value.some((e) => typeof e !== "string")) {
    throw new Error(`"pi.${key}" in ${file} is not a list of strings. Fix the file by hand.`);
  }
  return value as string[];
}

function packageFiles(root: string): { label: string; files: { kind: Exclude<Kind, "builtin">; path: string }[] } {
  const file = join(root, "package.json");
  let pkg: { name?: unknown; pi?: Record<string, unknown> } = {};
  if (existsSync(file)) {
    try {
      pkg = JSON.parse(readFileSync(file, "utf8"));
    } catch (cause) {
      throw new Error(`Cannot read ${file}: ${errorText(cause)}. Fix the file by hand.`, { cause });
    }
  }
  const files = KINDS.flatMap((kind) => {
    const patterns = manifestList(pkg.pi, KEY[kind], file);
    const excluded = patterns.filter((p) => p.startsWith("!")).map((p) => globRegExp(p.slice(1)));
    return patterns
      .filter((p) => !p.startsWith("!"))
      .flatMap((p) => expandGlob(root, p))
      .flatMap((p) => resolveEntry(kind, p))
      .filter((p) => !excluded.some((re) => re.test(posix(relative(root, p)))))
      .map((path) => ({ kind, path }));
  });
  return { label: typeof pkg.name === "string" ? pkg.name : basename(root), files };
}

function nameOf(kind: Exclude<Kind, "builtin">, path: string, base: string): string {
  if (kind === "extension") return posix(relative(base, path));
  return basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path);
}

export interface Discovery {
  resources: Resource[];
  /** Messages about packages that this module cannot list. */
  skipped: string[];
}

export function discover(env: Env, user: Settings, project: Settings): Discovery {
  const resources: Resource[] = [];
  const skipped: string[] = [];
  const isSelf = (path: string) => env.selfDir !== undefined && path.startsWith(env.selfDir + sep);

  for (const name of BUILTINS) {
    resources.push({ kind: "builtin", group: "Built-in", name, origin: "builtin", path: `builtin:${name}`, home: "builtin", protected: false });
  }

  for (const scope of ["user", "project"] as const) {
    const base = baseDir(scope, env);
    for (const kind of KINDS) {
      const dir = join(base, KEY[kind]);
      for (const path of resolveEntry(kind, dir)) {
        resources.push({
          kind,
          group: kind === "extension" ? "Extensions" : GROUP[kind],
          name: nameOf(kind, path, dir),
          origin: scope,
          path,
          home: scope,
          protected: isSelf(path),
        });
      }
    }
  }

  const seen = new Set<string>();
  for (const [scope, settings] of [
    ["user", user],
    ["project", project],
  ] as const) {
    for (const { source } of packageEntries(settings, settingsPath(scope, env))) {
      if (!isLocal(source)) {
        skipped.push(`Package ${source} is not a local path. /ext lists local packages only; use \`pi config\` for it.`);
        continue;
      }
      const root = identityOf(source, baseDir(scope, env));
      if (seen.has(root)) continue;
      seen.add(root);
      if (typeOf(root) !== "dir") {
        skipped.push(`Package ${source} (${root}) does not exist. Fix "packages" in ${settingsPath(scope, env)}.`);
        continue;
      }
      const { label, files } = packageFiles(root);
      for (const { kind, path } of files) {
        const name = nameOf(kind, path, root);
        resources.push({
          kind,
          group: `Package: ${label}`,
          name: kind === "extension" ? name : `${kind}:${name}`,
          origin: label,
          path,
          home: scope,
          pkg: { identity: root, root },
          protected: isSelf(path),
        });
      }
    }
  }
  return { resources, skipped };
}

// ---- State

type Sign = "+" | "-" | "!" | "";
const parse = (entry: string): { sign: Sign; pattern: string } =>
  /^[+\-!]/.test(entry) ? { sign: entry[0] as Sign, pattern: entry.slice(1) } : { sign: "", pattern: entry };

type Test = (pattern: string) => boolean;

function pathTest(base: string, path: string): Test {
  const target = posix(relative(base, path));
  return (pattern) => {
    const p = posix(relative(base, resolve(base, expandHome(pattern.replace(/\/$/, "")))));
    return globRegExp(p).test(target) || target.startsWith(`${p}/`);
  };
}

/**
 * "filter": a package filter list (an empty list or plain entries set the base).
 * "delta": a top-level list or a project delta (only signed entries decide).
 */
function decide(entries: string[], test: Test, mode: "filter" | "delta"): boolean | undefined {
  const parsed = entries.map(parse);
  const plain = parsed.filter((e) => e.sign === "");
  let on: boolean | undefined;
  if (mode === "filter") on = entries.length === 0 ? false : plain.length > 0 ? plain.some((e) => test(e.pattern)) : true;
  if (parsed.some((e) => e.sign === "!" && test(e.pattern))) on = false;
  for (const e of parsed) if ((e.sign === "+" || e.sign === "-") && test(e.pattern)) on = e.sign === "+";
  return on;
}

function decideIn(res: Resource, scope: Scope, env: Env, settings: Settings): boolean | undefined {
  const path = settingsPath(scope, env);
  if (res.kind === "builtin") return decide(list(settings, "extensions", path), (p) => p === res.path, "delta");
  const key = KEY[res.kind];
  if (!res.pkg) return decide(list(settings, key, path), pathTest(baseDir(scope, env), res.path), "delta");
  const found = findPackage(settings, scope, env, res.pkg.identity);
  if (!found) return undefined;
  const delta = scope === "project" && found.entry.autoload === false;
  if (found.entry[key] === undefined) return scope === "project" && !delta ? true : undefined;
  return decide(list(found.entry, key, path), pathTest(res.pkg.root, res.path), delta ? "delta" : "filter");
}

export function stateOf(res: Resource, env: Env, user: Settings, project: Settings): Pick<Row, "enabled" | "scope"> {
  const inProject = decideIn(res, "project", env, project);
  if (inProject !== undefined) return { enabled: inProject, scope: "project" };
  const inUser = decideIn(res, "user", env, user);
  if (inUser !== undefined) return { enabled: inUser, scope: "user" };
  return { enabled: true, scope: "default" };
}

export function loadRows(env: Env): { rows: Row[]; skipped: string[] } {
  const user = readSettings("user", env);
  const project = readSettings("project", env);
  const { resources, skipped } = discover(env, user, project);
  const order = (r: Resource) =>
    r.group === "Built-in" ? 0 : r.group === "Extensions" ? 1 : r.group.startsWith("Package: ") ? 2 : r.group === "Skills" ? 3 : r.group === "Prompts" ? 4 : 5;
  const rows = resources
    .map((r) => ({ ...r, ...stateOf(r, env, user, project) }))
    .sort((a, b) => order(a) - order(b) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin));
  return { rows, skipped };
}

export const refOf = (r: Resource) => `${r.name}@${r.origin}`;

export function findRow(rows: Row[], query: string): Row {
  const matches = rows.filter((r) => r.name === query || refOf(r) === query);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Name "${query}" is not unique. Use one of: ${matches.map(refOf).join(", ")}.`);
  }
  const known = [...new Set(rows.map((r) => r.name))].join(", ");
  throw new Error(`Unknown resource "${query}". Known names: ${known}. Run "/ext list" to see them by group.`);
}

// ---- Toggle

const setEntry = (entries: string[], pattern: string, enabled: boolean) => [
  ...entries.filter((e) => {
    const p = parse(e);
    return !(p.sign !== "" && p.pattern === pattern);
  }),
  `${enabled ? "+" : "-"}${pattern}`,
];

/** Returns a changed copy of the settings of `scope`. Does not touch the files. */
export function applyToggle(env: Env, res: Resource, scope: Scope, enabled: boolean, settings: Settings): Settings {
  if (res.protected && !enabled) {
    throw new Error(
      `Cannot disable ${res.name}: it provides /ext. After a reload you could not enable it again from the session. Edit ${settingsPath(scope, env)} by hand.`,
    );
  }
  const path = settingsPath(scope, env);
  const next = structuredClone(settings);
  const base = baseDir(scope, env);

  if (res.pkg) {
    const key = KEY[res.kind as Exclude<Kind, "builtin">];
    const packages = packageEntries(next, path);
    let index = packages.findIndex((e) => identityOf(e.source, base) === res.pkg!.identity);
    if (index < 0) {
      if (scope === "user") {
        throw new Error(`Package ${res.origin} is not in ${path}. Switch to project scope (Tab, or --project) to change ${res.name}.`);
      }
      const rel = posix(relative(base, res.pkg.root));
      packages.push({ source: rel.startsWith(".") ? rel : `./${rel}`, autoload: false });
      index = packages.length - 1;
    }
    const entry = packages[index];
    entry[key] = setEntry(list(entry, key, path), posix(relative(res.pkg.root, res.path)), enabled);
    next.packages = packages;
    return next;
  }

  const key = res.kind === "builtin" ? "extensions" : KEY[res.kind];
  let entries = list(next, key, path);
  if (res.kind === "builtin") {
    entries = setEntry(entries, res.path, enabled);
  } else if (res.home === scope) {
    entries = setEntry(entries, posix(relative(base, res.path)), enabled);
  } else if (scope === "project") {
    if (!entries.includes(res.path)) entries = [...entries, res.path];
    entries = setEntry(entries, res.path, enabled);
  } else {
    throw new Error(`${res.name} lives in the project. Switch to project scope (Tab, or --project) to change it.`);
  }
  next[key] = entries;
  return next;
}

/** Changes one resource in the settings file of `scope`. */
export function toggle(env: Env, res: Resource, scope: Scope, enabled: boolean): void {
  writeSettings(scope, env, applyToggle(env, res, scope, enabled, readSettings(scope, env)));
}
