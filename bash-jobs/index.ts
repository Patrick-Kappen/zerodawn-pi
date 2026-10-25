import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundShortcut, registerBash } from "./bash.ts";
import { registerWaitGuard } from "./guard.ts";
import { registerJobs } from "./jobs.ts";
import { createState } from "./state.ts";
import { createDashboard } from "./dashboard.ts";
import { registerMessageRenderer } from "./render.ts";

export default function (pi: ExtensionAPI) {
  const s = createState();
  registerBackgroundShortcut(pi, s);
  const widget = createDashboard(pi, s);
  registerMessageRenderer(pi);
  const reports = registerJobs(pi, s, widget);
  registerWaitGuard(pi, s);
  registerBash(pi, s, widget, reports);
}
