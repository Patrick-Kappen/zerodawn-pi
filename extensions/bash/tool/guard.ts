import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripQuoted } from "../../../shared/util.ts";
import { hasBackgroundJob, type State } from "../state.ts";

const WAIT = new Set(["sleep", "wait", "true", ":"]);

export function waitsOnly(command: string): boolean {
  const words = stripQuoted(command)
    .split(/&&|\|\||;|\n/)
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
  return words.length > 0 && words.every((w) => WAIT.has(w));
}

export function registerWaitGuard(pi: ExtensionAPI, s: State) {
  pi.on("tool_call", (event) => {
    const command = (event.input as { command?: unknown }).command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    if (!waitsOnly(command)) return;
    if (hasBackgroundJob(s)) return { block: true, reason: "a message reports the job; do other work or end the turn" };
    return { block: true, reason: "chain the wait with its next step: timeout 30 bash -c 'until CHECK; do sleep 1; done' && NEXT" };
  });
}
