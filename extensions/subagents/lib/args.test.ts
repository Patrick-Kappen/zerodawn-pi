import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

test("parseArgs reads session, dir and id", () => {
  assert.deepEqual(parseArgs(["--session", "pi-sub-0199a1b2", "--dir", "/tmp/pi-sub-0199a1b2"]), {
    session: "pi-sub-0199a1b2",
    dir: "/tmp/pi-sub-0199a1b2",
    id: "0199a1b2",
  });
});

test("parseArgs fails on missing, unknown, repeated and bad arguments", () => {
  assert.throws(() => parseArgs([]), /--session is missing/);
  assert.throws(() => parseArgs(["--session", "pi-sub-0199a1b2"]), /--dir is missing/);
  assert.throws(() => parseArgs(["--x", "1"]), /unknown argument/);
  assert.throws(() => parseArgs(["--session"]), /no value/);
  assert.throws(() => parseArgs(["--session", "a", "--session", "b"]), /twice/);
  assert.throws(() => parseArgs(["--session", "bad", "--dir", "/tmp/pi-sub-0199a1b2"]), /not valid/);
  assert.throws(() => parseArgs(["--session", "pi-sub-0199a1b2", "--dir", "/etc/x"]), /not valid/);
  assert.throws(() => parseArgs(["--session", "pi-sub-0199a1b2", "--dir", "/tmp/pi-sub-ffffffff"]), /different ids/);
});
