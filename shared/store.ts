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

export const shorten = (path: string) => path.replace(homedir(), "~");
