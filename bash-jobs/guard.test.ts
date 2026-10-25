import { test } from "node:test";
import assert from "node:assert/strict";
import { waitsOnly } from "./guard.ts";

const waiting = ["sleep 30", "sleep 5; sleep 5", "sleep 10 && wait", "true"];
const working = ["sleep 2 && ls", "nix build .#x", "echo 'sleep 5'", ""];
for (const c of waiting) test(`waits only: ${c}`, () => assert.equal(waitsOnly(c), true, c));
for (const c of working) test(`does work: ${c || "(empty)"}`, () => assert.equal(waitsOnly(c), false, c));
