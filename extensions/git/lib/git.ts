import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { callOutFile, outRef } from "../../../shared/store.ts";
import { absolutePath } from "../../../shared/util.ts";

const run = promisify(execFile);
const PATCH = ["-U1", "--no-color", "--no-ext-diff"];
const INLINE_MAX = 4000;
const LOG_DEFAULT = 10;
const LOG_MAX = 50;
const LIST_MAX = 20;

type Entry = { key: string; path: string; line: string; [k: string]: any };

function group(entries: Entry[], suffix: (n: number, items: Entry[]) => string): string[] {
  let rows: { key: string; dir?: string; items: Entry[] }[] = entries.map((e) => ({ key: e.key, items: [e] }));
  while (rows.length > LIST_MAX) {
    const count = new Map<string, number>();
    for (const r of rows) {
      const parts = (r.dir ?? r.items[0].path).split("/");
      for (let d = 1; d < parts.length; d++) {
        const k = `${r.key}\0${parts.slice(0, d).join("/")}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    let best: string | undefined;
    let bestN = 1;
    let bestDepth = 0;
    for (const [k, n] of count) {
      const depth = k.split("/").length;
      if (n > bestN || (n === bestN && n > 1 && depth > bestDepth)) [best, bestN, bestDepth] = [k, n, depth];
    }
    if (!best) break;
    const [key, dir] = best.split("\0");
    const inside = (r: (typeof rows)[number]) => r.key === key && (r.dir ?? r.items[0].path).startsWith(`${dir}/`);
    const merged = rows.filter(inside);
    const at = rows.indexOf(merged[0]);
    rows = rows.filter((r) => !inside(r));
    rows.splice(at, 0, { key, dir, items: merged.flatMap((r) => r.items) });
  }
  return rows.map((r) => (r.dir ? `${r.key ? `${r.key} ` : ""}${r.dir}/ ${suffix(r.items.length, r.items)}` : r.items[0].line));
}

function compactStatus(text: string): string {
  const [head, ...rest] = text.split("\n");
  const entries = rest.filter(Boolean).map((l) => ({ key: l.slice(0, 2), path: l.slice(3).replace(/\/$/, ""), line: l }));
  return [head, ...group(entries, (n) => `(${n} files)`)].join("\n");
}

function compactNumstat(text: string): string {
  const entries = text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [add, del, path] = l.split("\t");
      return { key: "", path, add, del, line: `+${add} -${del} ${path}` };
    });
  const sum = (items: any[], f: "add" | "del") => items.reduce((s, e) => s + (Number(e[f]) || 0), 0);
  const lines = group(entries, (n, items) => `+${sum(items, "add")} -${sum(items, "del")} (${n} files)`);
  lines.push(`${entries.length} files, +${sum(entries, "add")} -${sum(entries, "del")}`);
  return lines.join("\n");
}

function compactPatch(text: string): string {
  const out: string[] = [];
  let inHeader = false;
  for (const l of text.split("\n")) {
    if (l.startsWith("diff --git ")) {
      inHeader = true;
      continue;
    }
    if (inHeader) {
      if (l.startsWith("+++ ")) out.push(l === "+++ /dev/null" ? "+++ (deleted)" : l);
      else if (l.startsWith("@@")) {
        inHeader = false;
        out.push(l);
      }
      continue;
    }
    out.push(l);
  }
  return out.join("\n");
}

export function registerGit(pi: ExtensionAPI) {
  pi.registerTool({
    name: "git",
    label: "git",
    description:
      "Compact read-only git: status, diff, log, show. diff and show return a file summary (+added -deleted per file, large directories merged) unless you give paths; then ask for the patch of the paths you need, with 1 line of context. Large output goes to a log file. Use bash for git commands that change state (add, commit, checkout, rebase).",
    promptSnippet: "Compact git status, diff, log and show",
    parameters: Type.Object({
      action: StringEnum(["status", "diff", "log", "show"] as const),
      repo: Type.Optional(Type.String({ description: "Repository path. Default: current directory." })),
      ref: Type.Optional(Type.String({ description: "diff: a commit or range (main..HEAD). log: a range. show: a commit (default HEAD)." })),
      staged: Type.Optional(Type.Boolean({ description: "diff: show staged changes." })),
      paths: Type.Optional(Type.Array(Type.String(), { description: "Limit to these paths. diff/show: return the full content for them." })),
      n: Type.Optional(Type.Number({ description: `log: number of commits. Default ${LOG_DEFAULT}, max ${LOG_MAX}.` })),
    }),

    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      if (params.ref?.startsWith("-")) throw new Error(`git: ref "${params.ref}" starts with "-". Give a commit or range, not an option.`);
      const paths = params.paths ?? [];
      const ref = params.ref ? [params.ref] : [];
      const pathArgs = paths.length ? ["--", ...paths] : [];
      let args: string[];
      switch (params.action) {
        case "status":
          args = ["status", "--porcelain=v1", "-b", ...pathArgs];
          break;
        case "diff":
          args = ["diff", ...(params.staged ? ["--cached"] : []), ...(paths.length ? PATCH : ["--numstat"]), ...ref, ...pathArgs];
          break;
        case "log": {
          const n = Math.min(params.n ?? LOG_DEFAULT, LOG_MAX);
          args = ["log", "--oneline", "--no-decorate", `-n${n}`, ...ref, ...pathArgs];
          break;
        }
        case "show":
          args = paths.length
            ? ["show", ...PATCH, "--format=%h %s", ...(ref.length ? ref : ["HEAD"]), ...pathArgs]
            : ["show", "--numstat", "--format=%h %an %ad%n%s%n%b", "--date=short", ...(ref.length ? ref : ["HEAD"])];
          break;
      }

      const cwd = params.repo ? absolutePath(params.repo, ctx.cwd, { toolPath: false }) : ctx.cwd;
      let stdout: string;
      try {
        ({ stdout } = await run("git", ["-C", cwd, "--no-pager", ...args], { signal, maxBuffer: 64 * 1024 * 1024 }));
      } catch (err: any) {
        const stderr = String(err.stderr ?? "").trim();
        throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr || err.message}`, { cause: err });
      }

      let text = stdout.trimEnd();
      if (params.action === "status") text = compactStatus(text);
      else if ((params.action === "diff" || params.action === "show") && paths.length) text = compactPatch(text);
      else if (params.action === "diff") text = text && compactNumstat(text);
      else if (params.action === "show") {
        const lines = text.split("\n");
        const i = lines.findIndex((l) => /^(\d+|-)\t(\d+|-)\t/.test(l));
        text = i < 0 ? text : `${lines.slice(0, i).join("\n").trimEnd()}\n${compactNumstat(lines.slice(i).join("\n"))}`;
      }
      text = text.replace(/\n{3,}/g, "\n\n") || "(no output)";
      if (text.length <= INLINE_MAX) return { content: [{ type: "text", text }], details: {} };
      const log = callOutFile(ctx, toolCallId, "git");
      writeFileSync(log, text);
      const lines = text.split("\n").length;
      return {
        content: [
          { type: "text", text: `git ${params.action}: ${lines} lines, ${text.length} chars · log: ${outRef(log)} · use fewer paths for a smaller result` },
        ],
        details: { log },
      };
    },
  });
}
