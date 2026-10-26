import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "./index.ts";

test("the extension exports a function", () => {
  assert.equal(typeof extension, "function");
});
