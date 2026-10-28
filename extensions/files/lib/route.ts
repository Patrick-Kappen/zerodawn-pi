import { relative } from "node:path";
import type { Route } from "../../../shared/route.ts";
import { cutLines, GREP_LIMIT, GREP_PER_FILE, GrepLines, type Params, rgArgs } from "./grep.ts";
import { fileLines } from "./lines.ts";
import { renderRead } from "./read.ts";

const UNQUOTED = /[|<>$`(){}*?[\];&#~\\!]/;
const quote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);

/** The words of a simple command, or undefined when the part has shell syntax beyond plain quotes. */
export function shellWords(part: string): string[] | undefined {
  const words: string[] = [];
  let word: string | undefined;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (c === "'" || c === '"') {
      const end = part.indexOf(c, i + 1);
      if (end < 0) return undefined;
      const text = part.slice(i + 1, end);
      if (c === '"' && /[$`\\!]/.test(text)) return undefined;
      word = (word ?? "") + text;
      i = end;
    } else if (/\s/.test(c)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else if (UNQUOTED.test(c)) return undefined;
    else word = (word ?? "") + c;
  }
  if (word !== undefined) words.push(word);
  return words;
}

type ReadSpec = { path: string; offset?: number; limit?: number };

const count = (text: string | undefined) => (text && /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : undefined);

// The line options of head and tail: -n N, -nN, -N, --lines=N. tail also takes +K for "from line K".
function lineCount(args: string[]): { n?: string; rest: string[] } | undefined {
  const rest: string[] = [];
  let n: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const m = a.match(/^-n(.+)$|^--lines=(.+)$|^-(\d+)$/);
    if (a === "-n" || a === "--lines") n = args[++i];
    else if (m) n = m[1] ?? m[2] ?? m[3];
    else if (a.startsWith("-")) return undefined;
    else rest.push(a);
  }
  return { n, rest };
}

/** The read tool parameters for a file view in bash: cat, nl, less, more, bat, head, tail, sed -n 'A,Bp'. */
export function readSpec(words: string[]): ReadSpec | undefined {
  const [cmd, ...args] = words;
  const one = (rest: string[]) => (rest.length === 1 && rest[0] !== "-" ? rest[0] : undefined);
  switch (cmd) {
    case "cat":
    case "nl":
    case "less":
    case "more": {
      const path = one(args);
      return path ? { path } : undefined;
    }
    case "bat":
    case "batcat": {
      const path = one(args.filter((a) => !/^(-p|-pp|--plain|-n|--number|--paging=never|--style=\S+|--color=never)$/.test(a)));
      return path ? { path } : undefined;
    }
    case "head": {
      const r = lineCount(args);
      const path = r && one(r.rest);
      const limit = r?.n === undefined ? 10 : count(r.n);
      return path && limit ? { path, limit } : undefined;
    }
    case "tail": {
      const r = lineCount(args);
      const path = r && one(r.rest);
      if (!path) return undefined;
      if (r.n?.startsWith("+")) {
        const from = count(r.n.slice(1));
        return from ? { path, offset: from } : undefined;
      }
      const n = r.n === undefined ? 10 : count(r.n);
      return n ? { path, offset: -n } : undefined;
    }
    case "sed": {
      if (args.length !== 3 || args[0] !== "-n") return undefined;
      const m = args[1].match(/^(\d+)(?:,(\d+|\$))?p$/);
      const path = one([args[2]]);
      if (!m || !path || Number(m[1]) < 1) return undefined;
      if (m[2] === "$") return { path, offset: Number(m[1]) };
      const to = Number(m[2] ?? m[1]);
      return to < Number(m[1]) ? undefined : { path, offset: Number(m[1]), limit: to - Number(m[1]) + 1 };
    }
  }
  return undefined;
}

function readRoute(spec: ReadSpec): Route {
  return {
    command: `cat -- ${quote(spec.path)}`,
    format: (output, exit) => {
      if (exit !== 0 || output.includes("\0")) return output;
      try {
        return renderRead(spec.path, fileLines(output), spec.offset, spec.limit, new Set()).text;
      } catch (err) {
        // renderRead throws for an offset beyond the end; the reason is the result of the part.
        return (err as Error).message;
      }
    },
  };
}

type GrepSpec = { params: Params; target: string };
type Key = "ignoreCase" | "literal" | "filesOnly" | "count" | "multiline" | "noIgnore" | "ere";
type Valued = "context" | "pattern" | "glob" | "type";

const BOOL: Record<string, Key> = {
  i: "ignoreCase",
  "--ignore-case": "ignoreCase",
  F: "literal",
  "--fixed-strings": "literal",
  l: "filesOnly",
  "--files-with-matches": "filesOnly",
  c: "count",
  "--count": "count",
};
// Options that change nothing in the result of the grep tool: it searches directories and gives paths and line numbers.
const OPTIONS = {
  grep: {
    same: new Set([
      "r",
      "R",
      "n",
      "H",
      "s",
      "I",
      "--recursive",
      "--dereference-recursive",
      "--line-number",
      "--with-filename",
      "--no-messages",
      "--color=never",
      "--colour=never",
    ]),
    bool: { ...BOOL, E: "ere", "--extended-regexp": "ere" } as Record<string, Key>,
    valued: { C: "context", "--context": "context", e: "pattern", "--regexp": "pattern", "--include": "glob" } as Record<string, Valued>,
  },
  rg: {
    same: new Set(["n", "H", "--line-number", "--with-filename", "--hidden", "--no-heading", "--color=never"]),
    bool: { ...BOOL, U: "multiline", "--multiline": "multiline", "--no-ignore": "noIgnore" } as Record<string, Key>,
    valued: { C: "context", "--context": "context", e: "pattern", "--regexp": "pattern", g: "glob", "--glob": "glob", t: "type", "--type": "type" } as Record<
      string,
      Valued
    >,
  },
};
// A basic grep pattern with one of these has another meaning in rg.
const BRE_ONLY = /[(){}|+?]|\\[^.[\]*^$/\\-]/;

/** The grep tool parameters for grep, egrep, fgrep or rg on one path, with only the options that the tool has. */
export function grepSpec(words: string[]): GrepSpec | undefined {
  const [cmd, ...args] = words;
  if (!["grep", "egrep", "fgrep", "rg"].includes(cmd)) return undefined;
  const rg = cmd === "rg";
  const opts = rg ? OPTIONS.rg : OPTIONS.grep;
  // grep -r searches also the paths that .gitignore names.
  const flags: Partial<Record<Key, boolean>> = { ere: cmd === "egrep", literal: cmd === "fgrep", noIgnore: !rg };
  const values: Partial<Record<Valued, string>> = {};
  const positional: string[] = [];
  const set = (key: Valued, value: string | undefined) => {
    if (value === undefined || values[key] !== undefined || (key === "context" && !count(value))) return false;
    values[key] = value;
    return true;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") positional.push(a);
    else if (opts.same.has(a)) continue;
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq < 0 ? a : a.slice(0, eq);
      if (opts.bool[a]) flags[opts.bool[a]] = true;
      else if (!opts.valued[name] || !set(opts.valued[name], eq < 0 ? args[++i] : a.slice(eq + 1))) return undefined;
    } else if (!rg && /^-\d+$/.test(a)) {
      if (!set("context", a.slice(1))) return undefined;
    } else
      for (let k = 1; k < a.length; k++) {
        const c = a[k];
        if (opts.same.has(c)) continue;
        if (opts.bool[c]) flags[opts.bool[c]] = true;
        else if (!opts.valued[c] || !set(opts.valued[c], a.slice(k + 1) || args[++i])) return undefined;
        else break;
      }
  }
  const pattern = values.pattern ?? positional.shift();
  if (!pattern || positional.length > 1 || (!rg && positional.length === 0) || (flags.filesOnly && flags.count)) return undefined;
  if (!rg && !flags.ere && !flags.literal && BRE_ONLY.test(pattern)) return undefined;
  const params: Params = { pattern };
  for (const key of ["ignoreCase", "literal", "filesOnly", "count", "multiline", "noIgnore"] as const) if (flags[key]) params[key] = true;
  if (values.glob) params.glob = values.glob;
  if (values.type) params.type = values.type;
  if (values.context) params.context = Number(values.context);
  return { params, target: positional[0] ?? "." };
}

function grepRoute({ params, target }: GrepSpec): Route {
  const json = !(params.filesOnly || params.count);
  return {
    command: ["rg", ...rgArgs(params, false), "--", params.pattern, target].map(quote).join(" "),
    format: (output, exit) => {
      const data: string[] = [];
      const errors: string[] = [];
      for (const line of output.split("\n").filter(Boolean)) (json ? line.startsWith("{") : !line.startsWith("rg: ")) ? data.push(line) : errors.push(line);
      if (exit > 1 && !data.length) return output;
      const pathOf = (line: string): string | undefined => (json ? JSON.parse(line).data?.path?.text : line.replace(/:\d+$/, ""));
      // rg prints the target itself for a file, and the paths below it for a directory.
      const isDir = data.some((line) => {
        const path = pathOf(line);
        return path !== undefined && path !== target;
      });
      const found = new GrepLines(params, (p) => relative(target, p) || p, GREP_LIMIT, isDir ? GREP_PER_FILE : undefined);
      for (const line of data) if (!found.take(line)) break;
      return cutLines(found.text(isDir, errors.join("\n")));
    },
  };
}

/** The read or grep tool for a file view or search in bash. Other parts run as written. */
export function fileRoute(part: string): Route | undefined {
  const words = shellWords(part);
  if (!words?.length) return undefined;
  const read = readSpec(words);
  if (read) return readRoute(read);
  const grep = grepSpec(words);
  return grep && grepRoute(grep);
}
