import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripQuoted } from "../shared/util.ts";
import { hasBackgroundJob, type State } from "./state.ts";

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
    if (hasBackgroundJob(s) && waitsOnly(command))
      return { block: true, reason: "Do not wait for a background job. End the turn or do other work; a message reports the result." };
  });
}
