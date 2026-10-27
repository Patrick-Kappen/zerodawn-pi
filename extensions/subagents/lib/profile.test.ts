import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProfile } from "./profile.ts";

const F = "/h/a.md";

test("valid profile with block list, inline lists and absent keys", () => {
  const profile = parseProfile(
    "---\ndescription: Read-only scout.\nextensions: [files, builtin:codemode]\ntools: []\n\n---\nYou are a scout.\n\nBe brief.\n",
    F,
  );
  assert.deepEqual(profile, {
    description: "Read-only scout.",
    tools: [],
    extensions: ["files", "builtin:codemode"],
    skills: [],
    checks: [],
    prompt: "You are a scout.\n\nBe brief.",
  });
});

test("errors name the file and the line", () => {
  const ok = "description: d\nskills: []\n";
  const cases: [string, RegExp][] = [
    [`---\n${ok}colour: red\n---\nP`, /a\.md, line 4: unknown key "colour"/],
    [`---\n${ok}---\n  \n`, /line 4: the prompt text .* is empty/],
    [`---\n${ok}garbage\n---\nP`, /line 4: expected "key: value"/],
    [`---\n${ok}models: [m]\n---\nP`, /a\.md, line 4: key "models" is not allowed\. Remove it.*subagentModels/],
    [`---\ntools: []\n---\nP`, /key "description" is missing/],
    [`---\n${ok}tools: read\n---\nP`, /line 4: key "tools" needs a list/],
    [`---\n${ok}tools: [a, ]\n---\nP`, /line 4: a list item is empty/],
    [`---\n${ok}tools: [a\n---\nP`, /line 4: .*closing "\]"/],
    [`---\n${ok}tools: [a]\ntools: [b]\n---\nP`, /line 5: key "tools" is given twice/],
    [`${ok}---\nP`, /line 1: the file must start/],
    [`---\n${ok}P`, /no closing "---"/],
  ];
  for (const [text, pattern] of cases) assert.throws(() => parseProfile(text, F), pattern);
});
