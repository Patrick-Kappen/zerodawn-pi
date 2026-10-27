import assert from "node:assert/strict";
import { test } from "node:test";
import { Markdown } from "@earendil-works/pi-tui";
import { inner } from "./messages.ts";

test("inner: a terminal of 0 or 1 column gives width 0, and pi's Markdown renders it without a throw", () => {
  assert.equal(inner(80), 78);
  assert.equal(inner(1), 0);
  assert.equal(inner(0), 0);
  const theme = new Proxy({}, { get: () => (s: string) => s });
  const md = new Markdown("text", 0, 1, theme as never);
  assert.doesNotThrow(() => md.render(inner(1)));
  assert.throws(() => md.render(-1), RangeError);
});
