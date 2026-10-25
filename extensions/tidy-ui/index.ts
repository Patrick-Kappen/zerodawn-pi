import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeBlocks } from "./code-blocks.ts";
import { registerFooter } from "./footer.ts";
import { registerMessages } from "./messages.ts";
import { registerTheme } from "./theme.ts";
import { registerViews } from "./views.ts";
import { registerWorking } from "./working.ts";

export default function (pi: ExtensionAPI): void {
  registerTheme(pi);
  registerCodeBlocks(pi);
  registerViews(pi);
  registerMessages(pi);
  registerFooter(pi);
  registerWorking(pi);
}
