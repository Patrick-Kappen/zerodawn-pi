import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_WAIT_MS, pollDecision, QUIET_MS, STABLE_MS, TIMEOUT_MS } from "./poll.ts";

test("a clean file: a client that is quiet for 3 s without open progress is done", () => {
  assert.equal(pollDecision({ clients: 1, counter: 0, busy: 0, quiet: QUIET_MS - 1 }, 4000, 4000), "wait");
  assert.equal(pollDecision({ clients: 1, counter: 0, busy: 0, quiet: QUIET_MS }, 4000, 4000), "done");
});

test("a clean file: open progress keeps waiting, then times out", () => {
  assert.equal(pollDecision({ clients: 1, counter: 0, busy: 1, quiet: QUIET_MS * 2 }, 5000, 5000), "wait");
  assert.equal(pollDecision({ clients: 1, counter: 0, busy: 1, quiet: QUIET_MS * 2 }, TIMEOUT_MS, TIMEOUT_MS), "timeout");
});

test("quiet does not end the wait without a client or with an unstable counter", () => {
  assert.equal(pollDecision({ clients: 0, counter: 0, busy: 0, quiet: QUIET_MS }, 1000, 1000), "wait");
  assert.equal(pollDecision({ clients: 1, counter: 1, busy: 0, quiet: QUIET_MS }, 1000, 0), "wait");
});

test("no client after 3 s: nothing to report", () => {
  assert.equal(pollDecision({ clients: 0, counter: 0 }, CLIENT_WAIT_MS - 1, CLIENT_WAIT_MS - 1), "wait");
  assert.equal(pollDecision({ clients: 0, counter: 0 }, CLIENT_WAIT_MS, 0), "none");
});

test("a counter that held still for 500 ms is done", () => {
  assert.equal(pollDecision({ clients: 1, counter: 1 }, 100, STABLE_MS - 1), "wait");
  assert.equal(pollDecision({ clients: 1, counter: 1 }, 100, STABLE_MS), "done");
});

test("a counter that changes resets the stable time", () => {
  assert.equal(pollDecision({ clients: 1, counter: 2 }, 800, 0), "wait");
  assert.equal(pollDecision({ clients: 1, counter: 2 }, 800, STABLE_MS), "done");
});

test("an attached client without a result before 15 s is a timeout", () => {
  assert.equal(pollDecision({ clients: 1, counter: 0 }, TIMEOUT_MS - 1, TIMEOUT_MS - 1), "wait");
  assert.equal(pollDecision({ clients: 1, counter: 0 }, TIMEOUT_MS, TIMEOUT_MS), "timeout");
  assert.equal(pollDecision({ clients: 1, counter: 1 }, TIMEOUT_MS, STABLE_MS), "done", "a stable result wins over the timeout");
});
