import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { onRoutePart } from "../../shared/route.ts";
import { registerGit } from "./lib/git.ts";
import { gitRoute } from "./lib/route.ts";

export default function (pi: ExtensionAPI) {
  registerGit(pi);
  onRoutePart(pi, gitRoute);
}
