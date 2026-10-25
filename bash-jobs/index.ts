import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBackgroundShortcut, registerBash } from "./bash.ts";
import { registerBuiltins } from "./builtins.ts";
import { registerGit } from "./git.ts";
import { registerJobs } from "./jobs.ts";
import { registerLimits } from "./limits.ts";
import { createState } from "./state.ts";
import { createWidget } from "./widget.ts";

export default function (pi: ExtensionAPI) {
  const s = createState();
  registerBackgroundShortcut(pi, s);
  registerGit(pi);
  registerBuiltins(pi);
  const widget = createWidget(s);
  const reports = registerJobs(pi, s, widget);
  registerLimits(pi, s);
  registerBash(pi, s, widget, reports);
}
