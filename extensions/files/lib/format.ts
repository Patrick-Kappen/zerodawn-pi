import { execFile } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export type Formatter = { name: string; bin: string; args: string[]; cwd: string };

const TIMEOUT_MS = 30_000;
const BIOME = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonc|css)$/i;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const onPath = (name: string, env = process.env) => (env.PATH ?? "").split(delimiter).some((dir) => dir && executable(join(dir, name)));

// Directories from the file up to the repository root (the first directory with .git), or up to /.
function upward(file: string): string[] {
  const dirs: string[] = [];
  let dir = dirname(file);
  for (;;) {
    dirs.push(dir);
    if (existsSync(join(dir, ".git")) || dirname(dir) === dir) return dirs;
    dir = dirname(dir);
  }
}

const has = (file: string, text: string) => existsSync(file) && readFileSync(file, "utf8").includes(text);

function program(name: string, local: string | undefined, config: string, file: string): string {
  if (local && executable(local)) return local;
  if (onPath(name)) return name;
  throw new Error(
    `format of ${file}: ${config} sets ${name} as the formatter, but ${name} is not found${local ? ` at ${local}` : ""} or on PATH. Install ${name} or add it to the dev shell. The file did not change.`,
  );
}

// The formatter that the project of `file` configures; undefined when it configures none.
export function formatterFor(file: string): Formatter | undefined {
  const dirs = upward(file);
  const root = dirs[dirs.length - 1];
  if (BIOME.test(file)) {
    const dir = dirs.find((d) => existsSync(join(d, "biome.json")) || existsSync(join(d, "biome.jsonc")));
    if (!dir) return undefined;
    const bin = program("biome", join(dir, "node_modules", ".bin", "biome"), join(dir, "biome.json"), file);
    return { name: "biome", bin, args: ["format", "--write", "--no-errors-on-unmatched", file], cwd: dir };
  }
  if (/\.nix$/i.test(file) && has(join(root, "flake.nix"), "nixfmt")) {
    return { name: "nixfmt", bin: program("nixfmt", undefined, join(root, "flake.nix"), file), args: [file], cwd: root };
  }
  if (/\.py$/i.test(file)) {
    const dir = dirs.find((d) => existsSync(join(d, "ruff.toml")) || has(join(d, "pyproject.toml"), "[tool.ruff"));
    if (!dir) return undefined;
    return { name: "ruff", bin: program("ruff", undefined, dir, file), args: ["format", file], cwd: dir };
  }
  return undefined;
}

// Formats the file; gives a note for the model when the formatter changed it.
export function runFormatter(f: Formatter, file: string, name: string): Promise<string | undefined> {
  const before = readFileSync(file, "utf8");
  return new Promise((resolve, reject) => {
    execFile(f.bin, f.args, { cwd: f.cwd, timeout: TIMEOUT_MS, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error)
        return reject(
          new Error(
            `${name}: the change is applied, but ${f.name} failed: ${(stderr || stdout).trim() || error.message}. Fix the file, then run ${f.name} on it.`,
            { cause: error },
          ),
        );
      resolve(readFileSync(file, "utf8") === before ? undefined : `Formatted with ${f.name}; lines in the file can differ from your text.`);
    });
  });
}
