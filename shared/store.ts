import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function sessionDir(ctx: ExtensionContext): string {
  const file = ctx.sessionManager.getSessionFile();
  if (!file) throw new Error("bash: this session has no session file, so there is no place for the output. Start pi with a session.");
  return file.replace(/\.jsonl$/, "");
}

export function storeDir(ctx: ExtensionContext, kind: "out" | "jobs"): string {
  const dir = join(sessionDir(ctx), kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function callNumber(ctx: ExtensionContext, toolCallId: string): string {
  let turn = 0;
  let round = 0;
  for (const e of ctx.sessionManager.getBranch() as any[]) {
    if (e.type !== "message") continue;
    if (e.message.role === "user") {
      turn++;
      round = 0;
    } else if (e.message.role === "assistant") {
      round++;
      const calls = (e.message.content ?? []).filter((c: any) => c.type === "toolCall");
      const i = calls.findIndex((c: any) => c.id === toolCallId);
      if (i >= 0) return `${turn}.${round}-C${i + 1}`;
    }
  }
  return `x-${toolCallId.slice(-8)}`;
}

export function freeId(id: string, taken: (id: string) => boolean): string {
  let free = id;
  for (let n = 2; taken(free); n++) free = `${id}-${n}`;
  return free;
}

export function outFile(ctx: ExtensionContext, toolCallId: string, kind: string): string {
  const dir = storeDir(ctx, "out");
  const id = freeId(callNumber(ctx, toolCallId), (i) => existsSync(join(dir, `${i}.${kind}.log`)));
  return join(dir, `${id}.${kind}.log`);
}

// A codemode tool call has the id "<codemode call>/<n>"; only the codemode call is in the session.
export function callFileId(ctx: ExtensionContext, toolCallId: string): string {
  const [parent, ...rest] = toolCallId.split("/");
  const base = callNumber(ctx, parent);
  return rest.length ? `${base}.${rest.join(".").replace(/[^\w.-]/g, "_")}` : base;
}

export function callOutFile(ctx: ExtensionContext, toolCallId: string, kind: string): string {
  const dir = storeDir(ctx, "out");
  const id = freeId(callFileId(ctx, toolCallId), (i) => existsSync(join(dir, `${i}.${kind}.log`)));
  return join(dir, `${id}.${kind}.log`);
}

export const shorten = (path: string) => path.replace(homedir(), "~");

const SESSION_OUT = /\/\d{4}-\d\d-\d\dT[^/]*_[0-9a-f-]{36}\/out\/([^/]+)\.(?:log|txt)$/;

// The model gets "out:<name>" for a file in the out directory of a session; read and grep resolve it.
export function outRef(path: string): string {
  const m = path.match(SESSION_OUT);
  return m ? `out:${m[1]}` : shorten(path);
}

export function resolveOutRef(ctx: ExtensionContext, path: string): string | undefined {
  const m = path.match(/^out:([\w.-]+)$/);
  if (!m) return undefined;
  const dir = join(sessionDir(ctx), "out");
  const file = [`${m[1]}.txt`, `${m[1]}.log`].map((f) => join(dir, f)).find((f) => existsSync(f));
  if (!file) throw new Error(`${path} is not an output of this session (looked in ${shorten(dir)}). Run jobs list for the jobs.`);
  return file;
}
