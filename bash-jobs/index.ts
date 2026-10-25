import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundShortcut, registerBash } from "./bash.ts";
import { createDashboard } from "./dashboard.ts";
import { registerWaitGuard } from "./guard.ts";
import { registerJobs } from "./jobs.ts";
import { registerFollowView } from "./jobview.ts";
import { registerHiddenRenderers } from "./render.ts";
import { createState } from "./state.ts";

export default function (pi: ExtensionAPI) {
  const s = createState();
  registerBackgroundShortcut(pi, s);
  const widget = createDashboard(pi, s);
  registerHiddenRenderers(pi);
  registerFollowView(pi, s);
  const reports = registerJobs(pi, s, widget);
  registerWaitGuard(pi, s);
  registerBash(pi, s, widget, reports);
}
