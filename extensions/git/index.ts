import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGit } from "./lib/git.ts";
import { checkGit } from "./lib/guard.ts";

export default function (pi: ExtensionAPI) {
  registerGit(pi);
  pi.on("tool_call", (event) => {
    const command = (event.input as any).command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    const reason = checkGit(command);
    if (reason) return { block: true, reason };
  });
}
