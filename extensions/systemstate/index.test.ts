import assert from "node:assert/strict";
import { test } from "node:test";
import { deployedRevision, deploymentText } from "./index.ts";

test("deployedRevision strips the dirty marker", () => {
  assert.deepEqual(deployedRevision("abcdef1234-dirty"), { rev: "abcdef1234", dirty: true });
  assert.deepEqual(deployedRevision("abcdef1234"), { rev: "abcdef1234", dirty: false });
  assert.deepEqual(deployedRevision(undefined), { rev: undefined, dirty: false });
  assert.deepEqual(deployedRevision(""), { rev: undefined, dirty: false });
});

test("deploymentText reports deployed, ahead, unknown and dirty", () => {
  assert.equal(deploymentText(undefined, false, undefined), "Deployed revision unknown.");
  assert.equal(deploymentText("0123456789ab", false, "0"), "Deployed: 01234567 (HEAD).");
  assert.equal(deploymentText("0123456789ab", false, "3"), "Not deployed: HEAD is 3 commit(s) ahead of deployed 01234567.");
  assert.equal(deploymentText("0123456789ab", false, undefined), "Deployed: 01234567, not in this checkout.");
  assert.match(deploymentText("0123456789ab", true, "0"), /^Deployed: 01234567 \(HEAD\)\. Deployed from a dirty tree/);
});
