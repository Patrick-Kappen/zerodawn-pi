import assert from "node:assert/strict";
import { test } from "node:test";
import { EditQueue } from "./queue.ts";

test("runs one after the other", async () => {
  const order: string[] = [];
  const queue = new EditQueue();
  const a = queue.schedule("a", async () => {
    order.push("a1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push("a2");
  });
  const b = queue.schedule("b", async () => {
    order.push("b");
  });
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a1", "a2", "b"]);
});

test("a newer edit of the same file replaces a run that did not start", async () => {
  const order: string[] = [];
  const queue = new EditQueue();
  const first = queue.schedule("a", async () => {
    order.push("first");
  });
  const second = queue.schedule("a", async () => {
    order.push("second");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["second"]);
});

test("a run that already started is not replaced", async () => {
  const order: string[] = [];
  const queue = new EditQueue();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.schedule("a", async () => {
    order.push("first");
    await gate;
  });
  await Promise.resolve();
  const second = queue.schedule("a", async () => {
    order.push("second");
  });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});

test("a failed run does not stop the next; reset drops pending runs", async () => {
  const order: string[] = [];
  const queue = new EditQueue();
  const failed = queue.schedule("a", async () => {
    throw new Error("boom");
  });
  const next = queue.schedule("b", async () => {
    order.push("b");
  });
  await assert.rejects(failed, /boom/);
  await next;
  assert.deepEqual(order, ["b"]);

  const pending = queue.schedule("c", async () => {
    order.push("c");
  });
  queue.reset();
  await pending;
  assert.deepEqual(order, ["b"]);
});
