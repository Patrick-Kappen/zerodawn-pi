import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Profile, parseProfile } from "./profile.ts";

export interface Files {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(path: string): Promise<string[]>;
}

export const nodeFiles: Files = {
  exists: (path) =>
    access(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    ),
  read: (path) => readFile(path, "utf8"),
  list: (path) => readdir(path).then((names) => names.sort()),
};

export interface Resolved {
  profile: Profile;
  args: string[];
}

export const FIXED_TOOLS = ["ask", "blocker", "handoff", "continue", "done"];
const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function profilePath(home: string, name: string): string {
  if (!NAME.test(name)) throw new Error(`subagent: profile name "${name}" is not valid. Use a-z, 0-9 and "-"; start with a letter or digit.`);
  return join(home, ".pi", "agent", "agents", `${name}.md`);
}

export function buildArgs(profile: Profile, extensionPaths: string[], skillPaths: string[]): string[] {
  const args = [...extensionPaths.flatMap((path) => ["-e", path]), ...skillPaths.flatMap((path) => ["--skill", path])];
  // --tools is an allowlist that also filters extension tools, and --no-tools disables them: ask, blocker, handoff, continue and done must be named.
  args.push("--tools", [...profile.tools, ...FIXED_TOOLS].join(","));
  if (!profile.tools.some((tool) => tool.startsWith("mcp__"))) args.push("--no-mcp");
  args.push("--system-prompt", profile.prompt);
  return args;
}

export async function resolveProfile(home: string, name: string, files: Files): Promise<Resolved> {
  const path = profilePath(home, name);
  if (!(await files.exists(path))) throw new Error(`subagent: profile "${name}" not found. Create ${path}; see extensions/subagents/PROFILES.md.`);
  const profile = parseProfile(await files.read(path), path);

  const packages = join(home, ".pi", "agent", "packages");
  let packageDirs: string[] | undefined;
  const extensionPaths: string[] = [];
  for (const extension of profile.extensions) {
    if (extension.startsWith("builtin:")) {
      extensionPaths.push(extension);
      continue;
    }
    if (packageDirs === undefined) {
      if (!(await files.exists(packages)))
        throw new Error(`subagent: extension "${extension}" of profile ${path} needs the packages directory ${packages}, which does not exist.`);
      packageDirs = await files.list(packages);
    }
    let found: string | undefined;
    for (const dir of packageDirs) {
      const candidate = join(packages, dir, "extensions", extension, "index.ts");
      if (await files.exists(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found === undefined)
      throw new Error(`subagent: extension "${extension}" of profile ${path} not found in ${packages}/*/extensions/${extension}/index.ts.`);
    extensionPaths.push(found);
  }

  const skillPaths: string[] = [];
  for (const skill of profile.skills) {
    const skillPath = join(home, ".pi", "agent", "skills", skill);
    if (!(await files.exists(skillPath))) throw new Error(`subagent: skill "${skill}" of profile ${path} not found. Expected ${skillPath}.`);
    skillPaths.push(skillPath);
  }
  return { profile, args: buildArgs(profile, extensionPaths, skillPaths) };
}
