import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { onRoutePart, routedChain } from "../../shared/route.ts";
import { registerGit } from "./lib/git.ts";
import { checkGit } from "./lib/guard.ts";
import { gitRoute } from "./lib/route.ts";

export default function (pi: ExtensionAPI) {
  registerGit(pi);
  onRoutePart(pi, gitRoute);
  pi.on("tool_call", (event) => {
    const command = (event.input as any).command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    // The bash tool runs each git part of a chain through gitRoute.
    if (routedChain(pi, command)) return;
    const reason = checkGit(command);
    if (reason) return { block: true, reason };
  });
}
