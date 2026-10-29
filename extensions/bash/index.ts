import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createState } from "./state.ts";
import { registerBackgroundShortcut, registerBash } from "./tool/bash.ts";
import { registerChainRouting } from "./tool/chain.ts";
import { registerWaitGuard } from "./tool/guard.ts";
import { registerJobs } from "./tool/jobs.ts";
import { createDashboard } from "./ui/dashboard.ts";
import { registerFollowView } from "./ui/jobview.ts";
import { registerHiddenRenderers } from "./ui/render.ts";

export default function (pi: ExtensionAPI) {
  const s = createState();
  registerBackgroundShortcut(pi, s);
  const widget = createDashboard(pi, s);
  registerHiddenRenderers(pi);
  registerFollowView(pi, s);
  const reports = registerJobs(pi, s, widget);
  registerWaitGuard(pi, s);
  registerBash(pi, s, widget, reports);
  registerChainRouting(pi);
}
