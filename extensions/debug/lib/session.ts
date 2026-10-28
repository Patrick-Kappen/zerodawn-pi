import { basename, dirname, extname } from "node:path";
import type { Run } from "../../../shared/pair.ts";
import { expression } from "./lua.ts";

export type Deps = {
  run: Run;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  nvim: string;
  server: string;
};

export type Breakpoint = { file: string; line: number; condition?: string };
export type StartParams = { file: string; breakpoints?: Breakpoint[]; adapter?: string; args?: string[] };

type Variable = { name: string; value?: string; type?: string };
type Status = {
  status: "idle" | "starting" | "running" | "stopped" | "terminated" | "foreign";
  reason?: string;
  details?: boolean;
  details_error?: string;
  frames?: { name: string; file?: string; line?: number }[];
  locals?: { name: string; variables: Variable[] }[];
  source?: string;
  output?: string;
  exit_code?: number;
  error?: string;
};

const WAIT_MS = 30_000;
const POLL_MS = 150;
const OUTPUT_MAX = 2000;
const VALUE_MAX = 200;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);

/** The dap configuration for a file: the adapter comes from the extension unless the agent names one. */
export function dapConfig(params: StartParams, cwd: string): Record<string, unknown> {
  const ext = extname(params.file);
  const type = params.adapter ?? ({ ".py": "python", ".go": "delve" } as Record<string, string>)[ext] ?? "pwa-node";
  const args = params.args ?? [];
  if (type === "delve") {
    const test = basename(params.file).endsWith("_test.go");
    return { type, request: "launch", name: "pi debug", mode: test ? "test" : "debug", program: test ? dirname(params.file) : params.file, args, cwd };
  }
  if (type === "python") return { type, request: "launch", name: "pi debug", program: params.file, args, cwd };
  const runtimeArgs = [".ts", ".mts", ".cts"].includes(ext) ? ["--experimental-strip-types"] : [];
  return {
    type,
    request: "launch",
    name: "pi debug",
    program: params.file,
    args,
    cwd,
    runtimeExecutable: "node",
    runtimeArgs,
    skipFiles: ["<node_internals>/**"],
  };
}

export function formatStatus(s: Status): string {
  const out = (s.output ?? "").trim();
  if (s.status === "terminated") {
    const code = s.exit_code === undefined ? "unknown" : String(s.exit_code);
    return `terminated, exit code ${code}${out ? `\noutput (tail):\n${tail(out, OUTPUT_MAX)}` : ""}`;
  }
  const lines: string[] = [];
  const top = s.frames?.[0];
  lines.push(`stopped: ${s.reason ?? "unknown"}${top?.file ? ` at ${top.file}:${top.line}` : ""}`);
  if (s.source !== undefined) lines.push(`> ${s.source.trim()}`);
  if (s.details_error) lines.push(`details unavailable: ${s.details_error}`);
  if (s.frames?.length) {
    lines.push("stack:");
    for (const f of s.frames.slice(0, 10)) lines.push(`  ${f.name} ${f.file ?? "?"}:${f.line ?? "?"}`);
  }
  for (const scope of s.locals ?? []) {
    lines.push(`${scope.name}:`);
    for (const v of scope.variables) lines.push(`  ${v.name} = ${cut(String(v.value ?? ""), VALUE_MAX)}`);
  }
  if (out) lines.push(`output:\n${tail(out, OUTPUT_MAX)}`);
  return lines.join("\n");
}

export class Debugger {
  private readonly deps: Deps;
  private started = false;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  private async remote(expr: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const d = this.deps;
    return d.run(d.nvim, ["--clean", "--headless", "--server", d.server, "--remote-expr", expr]);
  }

  /** Runs one Lua op and returns the decoded JSON; an `error` field becomes an exception. */
  async call<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
    const r = await this.remote(expression(payload));
    if (r.code !== 0) throw new Error(`debug: nvim server ${this.deps.server} failed: ${r.stderr.trim() || `exit ${r.code}`}`);
    let data: { error?: string };
    try {
      data = JSON.parse(r.stdout.trim());
    } catch {
      throw new Error(`debug: unexpected answer from nvim server ${this.deps.server}: ${r.stdout.trim().slice(0, 200)}`);
    }
    if (data.error) throw new Error(`debug: ${data.error}`);
    return data as T;
  }

  /** Checks the socket; starts nvim@main once when it does not answer. */
  async connect(): Promise<void> {
    const d = this.deps;
    const ping = () => this.remote("1");
    if ((await ping()).code === 0) return;
    await d.run("systemctl", ["--user", "start", "nvim@main.service"]);
    const until = d.now() + 5000;
    while (d.now() < until) {
      await d.sleep(250);
      if ((await ping()).code === 0) return;
    }
    throw new Error(
      `debug: the nvim server socket ${d.server} does not answer, and 'systemctl --user start nvim@main.service' did not help within 5 s. Check 'journalctl --user -u nvim@main'.`,
    );
  }

  private async wait(): Promise<string> {
    const until = this.deps.now() + WAIT_MS;
    let last = "";
    while (this.deps.now() < until) {
      const s = await this.call<Status>({ op: "status" });
      if (s.status === "foreign") throw new Error("debug: the nvim server has its own dap session running; stop it before pi debugs.");
      last += s.output ?? "";
      s.output = last;
      if (s.status === "terminated") {
        this.started = false;
        return formatStatus(s);
      }
      if (s.status === "stopped" && (s.details || s.details_error)) return formatStatus(s);
      await this.deps.sleep(POLL_MS);
    }
    const out = last.trim();
    return `still running after ${WAIT_MS / 1000} s; call continue, eval or stop later${out ? `\noutput (tail):\n${tail(out, OUTPUT_MAX)}` : ""}`;
  }

  async start(params: StartParams, cwd: string): Promise<string> {
    await this.connect();
    await this.call({ op: "start", config: dapConfig(params, cwd), breakpoints: params.breakpoints ?? [] });
    this.started = true;
    return this.wait();
  }

  async step(op: "continue" | "step_over" | "step_into" | "step_out"): Promise<string> {
    await this.connect();
    await this.call({ op });
    return this.wait();
  }

  async evaluate(expression: string): Promise<string> {
    await this.connect();
    await this.call({ op: "eval", expression });
    const until = this.deps.now() + 10_000;
    while (this.deps.now() < until) {
      const { eval: result } = await this.call<{ eval?: { ok: boolean; value?: string; error?: string } }>({ op: "eval_poll" });
      if (result?.ok) return cut(result.value ?? "", VALUE_MAX * 5);
      if (result) throw new Error(`debug: eval failed: ${result.error}`);
      await this.deps.sleep(POLL_MS);
    }
    throw new Error("debug: eval did not answer within 10 s");
  }

  async stop(): Promise<string> {
    await this.connect();
    const r = await this.call<{ stopping?: boolean }>({ op: "stop" });
    if (r.stopping) {
      const until = this.deps.now() + 5000;
      while (this.deps.now() < until) {
        const s = await this.call<Status>({ op: "status" });
        if (s.status !== "running" && s.status !== "stopped") break;
        await this.deps.sleep(POLL_MS);
      }
    }
    const wiped = await this.call<{ kept?: unknown[] }>({ op: "wipe" });
    this.started = false;
    const kept = wiped.kept?.length ? ` ${wiped.kept.length} modified buffer(s) were kept.` : "";
    return `debug session stopped; breakpoints cleared, buffers wiped.${kept}`;
  }

  /** Best effort stop at the end of the pi session; silent when no session was started. */
  async shutdown(): Promise<void> {
    if (!this.started) return;
    await this.stop();
  }
}
