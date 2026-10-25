import assert from "node:assert/strict";
import { test } from "node:test";
import { hook, unhook } from "./hook.ts";

class Widget {
  render(width: number): string[] {
    return [`base ${width}`];
  }
}

test("layers wrap the original in registration order, the last layer runs first", () => {
  class A extends Widget {}
  hook(A.prototype, "render", "one", (_self, next, [width]) => [...next(width), "one"]);
  hook(A.prototype, "render", "two", (_self, next, [width]) => [...next(width - 1), "two"]);
  assert.deepEqual(new A().render(10), ["base 9", "one", "two"]);
});

test("a layer with the same key replaces the earlier one, unhook removes it", () => {
  class B extends Widget {}
  hook(B.prototype, "render", "k", (_self, next, [width]) => [...next(width), "v1"]);
  hook(B.prototype, "render", "k", (_self, next, [width]) => [...next(width), "v2"]);
  assert.deepEqual(new B().render(1), ["base 1", "v2"]);
  unhook(B.prototype, "render", "k");
  assert.deepEqual(new B().render(1), ["base 1"]);
});

test("the layer sees the instance as self", () => {
  class C extends Widget {
    name = "c";
  }
  hook(C.prototype, "render", "self", (self, next, [width]) => [self.name, ...next(width)]);
  assert.deepEqual(new C().render(2), ["c", "base 2"]);
});

test("a missing method fails loud with the hook key", () => {
  class D {}
  assert.throws(() => hook(D.prototype, "render", "views", () => []), /D\.render is missing.*"views"/);
});
