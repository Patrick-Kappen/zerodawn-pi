import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SyntaxError = { line: number; kind: string; text: string };
export type Checker = { nvim: string; parsers?: string };

// nvim -l SCRIPT PARSER_DIR LANG FILE...: prints a JSON array with the syntax errors of each FILE.
const SCRIPT = `local parsers, lang = _G.arg[1], _G.arg[2]
if parsers ~= "" then
  vim.opt.rtp:prepend(parsers)
end
local ok, added, err = pcall(vim.treesitter.language.add, lang)
if not ok or not added then
  io.stderr:write("no tree-sitter parser for " .. lang .. ": " .. tostring(ok and err or added) .. "\\n")
  os.exit(3)
end

local result = {}
for i = 3, #_G.arg do
  local lines = vim.fn.readfile(_G.arg[i])
  local tree = vim.treesitter.get_string_parser(table.concat(lines, "\\n"), lang):parse()[1]
  local errors = {}
  local function walk(node)
    if node:type() == "ERROR" or node:missing() then
      local row = node:range()
      local kind = node:missing() and ("missing " .. node:type()) or "syntax error"
      table.insert(errors, { line = row + 1, kind = kind, text = vim.trim(lines[row + 1] or "") })
      return
    end
    if node:has_error() then
      for child in node:iter_children() do
        walk(child)
      end
    end
  end
  walk(tree:root())
  table.insert(result, errors)
end
io.write(vim.json.encode(result))
`;
const TIMEOUT_MS = 20_000;
const MISSING_PARSER = 3;
const AROUND = 2;

const LANGUAGES: [RegExp, string][] = [
  [/\.(ts|mts|cts)$/i, "typescript"],
  [/\.tsx$/i, "tsx"],
  [/\.(js|mjs|cjs|jsx)$/i, "javascript"],
  [/\.nix$/i, "nix"],
  [/\.(sh|bash)$/i, "bash"],
  [/\.py$/i, "python"],
  [/\.lua$/i, "lua"],
  [/\.ya?ml$/i, "yaml"],
  [/\.json$/i, "json"],
];

export const language = (path: string) => LANGUAGES.find(([file]) => file.test(path))?.[1];

export function syntaxErrors(checker: Checker, lang: string, files: string[], where: string): Promise<SyntaxError[][]> {
  const dir = mkdtempSync(join(tmpdir(), "pi-syntax-"));
  const script = join(dir, "syntax.lua");
  writeFileSync(script, SCRIPT);
  const args = ["--clean", "--headless", "-l", script, checker.parsers ?? "", lang, ...files];
  return new Promise((resolve, reject) => {
    execFile(checker.nvim, args, { timeout: TIMEOUT_MS, encoding: "utf8" }, (error: any, stdout, stderr) => {
      rmSync(dir, { recursive: true, force: true });
      if (error?.code === "ENOENT")
        return reject(
          new Error(`syntax check of ${where}: nvim not found at "${checker.nvim}". Set programs.zerodawn-pi.nvim in Home Manager, or put nvim on PATH.`, {
            cause: error,
          }),
        );
      if (error?.code === MISSING_PARSER)
        return reject(new Error(`syntax check of ${where}: ${stderr.trim()}. Add the grammar to programs.zerodawn-pi.treesitterGrammars.`, { cause: error }));
      if (error) return reject(new Error(`syntax check of ${where}: nvim failed: ${stderr.trim() || error.message}`, { cause: error }));
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        return reject(new Error(`syntax check of ${where}: nvim gave no JSON: ${stdout.slice(0, 200)}`, { cause: err }));
      }
      if (!Array.isArray(parsed) || parsed.length !== files.length) return reject(new Error(`syntax check of ${where}: nvim gave ${stdout.slice(0, 200)}`));
      resolve(parsed.map((errors) => (Array.isArray(errors) ? errors : [])));
    });
  });
}

// Errors that the old content had too are not the fault of this change.
export function newErrors(before: SyntaxError[], after: SyntaxError[]): SyntaxError[] {
  const left = new Map<string, number>();
  const key = (e: SyntaxError) => `${e.kind}\0${e.text}`;
  for (const e of before) left.set(key(e), (left.get(key(e)) ?? 0) + 1);
  return after.filter((e) => {
    const n = left.get(key(e)) ?? 0;
    if (n > 0) left.set(key(e), n - 1);
    return n === 0;
  });
}

function report(name: string, content: string, errors: SyntaxError[]): string {
  const lines = content.split("\n");
  const parts = errors.map((e) => {
    const from = Math.max(1, e.line - AROUND);
    const to = Math.min(lines.length, e.line + AROUND);
    const region = lines
      .slice(from - 1, to)
      .map((l, k) => `${from + k}| ${l}`)
      .join("\n");
    return `line ${e.line}: ${e.kind}\n${region}`;
  });
  return `${name}: the change adds ${errors.length} syntax error(s), so it was undone. The file is as before. Fix the change and send it again. Your version (the "N| " prefix is not part of the file):\n${parts.join("\n...\n")}`;
}

// Runs a change of `file`; a change that adds a syntax error is undone and fails.
export async function checked<T>(checker: Checker, file: string, name: string, change: () => Promise<T>): Promise<T> {
  const lang = language(file);
  if (!lang) return change();
  const old = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const result = await change();
  const now = readFileSync(file, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "pi-syntax-"));
  try {
    const before = join(dir, "before");
    if (old !== undefined) writeFileSync(before, old);
    const errors = await syntaxErrors(checker, lang, old === undefined ? [file] : [before, file], name);
    const added = newErrors(old === undefined ? [] : errors[0], errors[errors.length - 1]);
    if (!added.length) return result;
    if (old === undefined) rmSync(file);
    else writeFileSync(file, old);
    throw new Error(report(name, now, added));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
