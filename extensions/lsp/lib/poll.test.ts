import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_WAIT_MS, pollDecision, STABLE_MS, TIMEOUT_MS } from "./poll.ts";

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
