import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodeBlocks } from "./features/code-blocks.ts";
import { registerFooter } from "./features/footer.ts";
import { registerMessages } from "./features/messages.ts";
import { registerViews } from "./features/views.ts";
import { registerWorking } from "./features/working.ts";
import { registerTheme } from "./lib/theme.ts";

export default function (pi: ExtensionAPI): void {
  registerTheme(pi);
  registerCodeBlocks(pi);
  registerViews(pi);
  registerMessages(pi);
  registerFooter(pi);
  registerWorking(pi);
}
