import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const GATEWAY_KEY_HEADER = "x-gateway-key";
export const SESSION_HEADER = "x-pi-session";

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_headers", (event, ctx) => {
    if (!(GATEWAY_KEY_HEADER in event.headers)) return;
    event.headers[SESSION_HEADER] = ctx.sessionManager.getSessionId();
  });
}
