import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { BACKGROUND_JOBS_QUERY, createState, registerJobsQuery } from "./state.ts";

const ask = (events: ReturnType<typeof createEventBus>) => {
  const query = { running: false };
  events.emit(BACKGROUND_JOBS_QUERY, query);
  return query.running;
};

test("the jobs query answers synchronously whether a background job runs", () => {
  const events = createEventBus();
  const s = createState();
  registerJobsQuery({ events }, s);
  assert.equal(ask(events), false);
  s.jobs.set("1", { bg: true } as any);
  assert.equal(ask(events), true);
  s.jobs.set("1", { bg: true, result: "exit 0" } as any);
  s.jobs.set("2", { bg: false } as any);
  assert.equal(ask(events), false);
});
