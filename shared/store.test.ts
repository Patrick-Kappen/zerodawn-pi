import { test } from "node:test";
import assert from "node:assert/strict";
import { freeId } from "./store.ts";

test("freeId keeps a free number and adds a suffix to a taken one", () => {
  assert.equal(freeId("3.2-C1", () => false), "3.2-C1");
  const taken = new Set(["3.2-C1", "3.2-C1-2"]);
  assert.equal(freeId("3.2-C1", (id) => taken.has(id)), "3.2-C1-3");
});
