import assert from "node:assert/strict";
import { test } from "node:test";
import { createLifecycle, type Timers } from "./lifecycle.ts";

function fakeClock() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  const timers: Timers = {
    setTimeout(callback, ms) {
      const handle = next++;
      pending.set(handle, callback);
      delays.push(ms);
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return { timers, pending, delays, fire: () => fireAll(pending) };
}

function fireAll(pending: Map<number, () => void>) {
  for (const [handle, callback] of [...pending]) {
    pending.delete(handle);
    callback();
  }
}

function setup(running: boolean) {
  const clock = fakeClock();
  let shutdowns = 0;
  const lifecycle = createLifecycle({ timers: clock.timers, graceMs: 500, agentsRunning: () => running, shutdown: () => shutdowns++ });
  return { clock, lifecycle, shutdowns: () => shutdowns };
}

test("main close without running agents shuts down at once", () => {
  const { lifecycle, shutdowns } = setup(false);
  lifecycle.mainOpened();
  assert.equal(lifecycle.isMainConnected(), true);
  lifecycle.mainClosed();
  assert.equal(shutdowns(), 1);
  assert.equal(lifecycle.isMainConnected(), false);
});

test("main close with running agents starts the timer; it ends in a shutdown", () => {
  const { clock, lifecycle, shutdowns } = setup(true);
  lifecycle.mainOpened();
  lifecycle.mainClosed();
  assert.equal(shutdowns(), 0);
  assert.deepEqual(clock.delays, [500, 500]);
  assert.equal(clock.pending.size, 1);
  clock.fire();
  assert.equal(shutdowns(), 1);
});

test("a reconnect cancels the timer", () => {
  const { clock, lifecycle, shutdowns } = setup(true);
  lifecycle.mainOpened();
  lifecycle.mainClosed();
  lifecycle.mainOpened();
  assert.equal(clock.pending.size, 0);
  clock.fire();
  assert.equal(shutdowns(), 0);
});

test("two main connections: only the last close counts", () => {
  const { lifecycle, shutdowns } = setup(false);
  lifecycle.mainOpened();
  lifecycle.mainOpened();
  lifecycle.mainClosed();
  assert.equal(shutdowns(), 0);
  lifecycle.mainClosed();
  assert.equal(shutdowns(), 1);
});

test("without a main hello the timer ends in a shutdown", () => {
  const { clock, shutdowns } = setup(false);
  assert.equal(clock.pending.size, 1);
  clock.fire();
  assert.equal(shutdowns(), 1);
});

test("the first main hello cancels the start timer", () => {
  const { clock, lifecycle, shutdowns } = setup(false);
  lifecycle.mainOpened();
  assert.equal(clock.pending.size, 0);
  clock.fire();
  assert.equal(shutdowns(), 0);
});

test("a close without an open fails loud", () => {
  assert.throws(() => setup(false).lifecycle.mainClosed(), /never opened/);
});
