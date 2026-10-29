import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { routePart } from "../../shared/route.ts";
import git from "./index.ts";

test("a git read in a bash command gets the git command of the tool", () => {
  const pi = { events: createEventBus(), on() {}, registerTool() {} };
  git(pi as any);
  assert.equal(routePart(pi, "git log -3")?.command, "git --no-pager log --oneline --no-decorate -n3");
  assert.equal(routePart(pi, "git log --graph"), undefined);
});
