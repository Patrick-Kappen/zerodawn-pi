/**
 * Finds check results that did not help the agent: from the behaviour in the session transcripts, and from the
 * check-anomalies.jsonl that the tests extension writes in each session directory. Run: just check-findings [since].
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The first words of a check result: the current one, and the one before 2026-10-27. */
const CHECK_HEAD = /^(Check result \(|Check commands in bash give a short result\.)/;
const LINTER = /(^|[;&|(]|\s-c|\bnpx|\bbunx)\s*(biome|eslint|tsc|shellcheck|statix|deadnix|nixfmt|ruff|mypy|pyright|cargo\s+clippy|go\s+vet)\b/;
const OTHER_FORM = /\|\s*(grep|tail|head|less|sed)\b|2>&1/;

export type Kind = "log read" | "rerun in another form" | "linter without short result";

export interface Finding {
  kind: Kind;
  /** The bash command of the check. */
  command: string;
  /** What the agent did next, or the result for a linter without short result. */
  detail: string;
}

interface Call {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

/** The tool calls of a transcript (pi session JSONL entries), in order, each with the text of its result. */
export function calls(entries: unknown[]): Call[] {
  const out: Call[] = [];
  const byId = new Map<string, Call>();
  for (const e of entries as { type?: string; message?: Record<string, unknown> }[]) {
    if (e?.type !== "message" || !e.message) continue;
    const m = e.message as { role: string; content: unknown; toolCallId?: string };
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const c of m.content as { type: string; id: string; name: string; arguments?: Record<string, unknown> }[]) {
        if (c.type !== "toolCall") continue;
        const call = { name: c.name, args: c.arguments ?? {}, result: "" };
        byId.set(c.id, call);
        out.push(call);
      }
    }
    if (m.role === "toolResult" && m.toolCallId && Array.isArray(m.content)) {
      const call = byId.get(m.toolCallId);
      if (call) call.result = (m.content as { type: string; text?: string }[]).map((x) => (x.type === "text" ? (x.text ?? "") : "")).join("");
    }
  }
  return out;
}

const command = (c: Call) => (c.name === "bash" ? String(c.args.command ?? "") : "");

/**
 * The findings of a transcript:
 * - log read: the next call after a check result reads its .check.log;
 * - rerun in another form: the next bash call runs the same linter with a pipe or 2>&1;
 * - linter without short result: a bash call runs a linter and gets the normal bash result.
 */
export function findings(entries: unknown[]): Finding[] {
  const list = calls(entries);
  const out: Finding[] = [];
  list.forEach((c, i) => {
    const cmd = command(c);
    if (!cmd) return;
    const isCheck = CHECK_HEAD.test(c.result);
    if (!isCheck) {
      if (LINTER.test(cmd)) out.push({ kind: "linter without short result", command: cmd, detail: c.result.split("\n")[0] });
      return;
    }
    const next = list[i + 1];
    if (!next) return;
    const path = String(next.args.path ?? "");
    if (next.name === "read" && path.endsWith(".check.log")) out.push({ kind: "log read", command: cmd, detail: path });
    const linter = cmd.match(LINTER)?.[2];
    const nextCmd = command(next);
    if (linter && nextCmd.includes(linter) && OTHER_FORM.test(nextCmd)) out.push({ kind: "rerun in another form", command: cmd, detail: nextCmd });
  });
  return out;
}

const ANOMALIES = "check-anomalies.jsonl";
const EXAMPLES = 3;

/** All findings and anomalies of the session files under dir changed at or after since, grouped by kind, with EXAMPLES examples each. */
export function scan(dir: string, since: Date): string {
  if (!existsSync(dir)) throw new Error(`check-findings: no session directory ${dir}; give the directory of the pi sessions.`);
  const groups = new Map<string, string[]>();
  const add = (kind: string, example: string) => groups.set(kind, [...(groups.get(kind) ?? []), example]);
  for (const project of readdirSync(dir)) {
    for (const name of readdirSync(join(dir, project))) {
      const path = join(dir, project, name);
      if (statSync(path).mtime < since) continue;
      if (name.endsWith(".jsonl")) {
        const entries = readFileSync(path, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l, i) => {
            try {
              return JSON.parse(l);
            } catch (cause) {
              throw new Error(`check-findings: line ${i + 1} of ${path} is no JSON; repair or move the file.`, { cause });
            }
          });
        for (const f of findings(entries)) add(f.kind, `${f.command}\n    → ${f.detail}`);
      } else if (existsSync(join(path, ANOMALIES))) {
        for (const l of readFileSync(join(path, ANOMALIES), "utf8").split("\n").filter(Boolean)) {
          const a = JSON.parse(l) as { signals: string[]; command: string; log: string };
          for (const s of a.signals) add(`anomaly: ${s}`, `${a.command}\n    → ${a.log}`);
        }
      }
    }
  }
  if (!groups.size) return `no findings since ${since.toISOString().slice(0, 10)}`;
  return [...groups]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([kind, ex]) => [`${kind}: ${ex.length}`, ...ex.slice(-EXAMPLES).map((e) => `  ${e}`)].join("\n"))
    .join("\n\n");
}

if (import.meta.main) {
  const since = new Date(process.argv[2] ?? Date.now() - 7 * 86400000);
  if (Number.isNaN(since.getTime())) throw new Error(`check-findings: "${process.argv[2]}" is no date; give a date such as 2026-10-20.`);
  console.log(scan(join(homedir(), ".pi", "agent", "sessions"), since));
}
