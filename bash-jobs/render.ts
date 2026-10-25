import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NOTHING = { render: () => [], invalidate() {} };

export function registerHiddenRenderers(pi: ExtensionAPI) {
  pi.registerToolRenderer(() => ({ renderShell: "self", renderCall: () => NOTHING, renderResult: () => NOTHING }));
  pi.registerMessageRenderer("bash-job", () => NOTHING);
}
