import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "./args.ts";

const base = ["--session", "pi-sub-0199a1b2", "--dir", "/tmp/pi-sub-0199a1b2"];
const rest = ["--pi", "pi", "--extension", "/x/index.ts"];

test("parseArgs reads session, dir, id, pi and extension", () => {
  assert.deepEqual(parseArgs([...base, ...rest]), {
    session: "pi-sub-0199a1b2",
    dir: "/tmp/pi-sub-0199a1b2",
    id: "0199a1b2",
    pi: "pi",
    extension: "/x/index.ts",
  });
});

test("parseArgs fails on missing, unknown, repeated and bad arguments", () => {
  assert.throws(() => parseArgs([]), /--session is missing/);
  assert.throws(() => parseArgs(["--session", "pi-sub-0199a1b2"]), /--dir is missing/);
  assert.throws(() => parseArgs(base), /--pi is missing/);
  assert.throws(() => parseArgs([...base, "--pi", "pi"]), /--extension is missing/);
  assert.throws(() => parseArgs([...base, "--pi", "pi", "--extension", "x/index.ts"]), /not absolute/);
  assert.throws(() => parseArgs(["--x", "1"]), /unknown argument/);
  assert.throws(() => parseArgs(["--session"]), /no value/);
  assert.throws(() => parseArgs(["--session", "a", "--session", "b"]), /twice/);
  assert.throws(() => parseArgs(["--session", "bad", "--dir", "/tmp/pi-sub-0199a1b2", ...rest]), /not valid/);
  assert.throws(() => parseArgs(["--session", "pi-sub-0199a1b2", "--dir", "/etc/x", ...rest]), /not valid/);
  assert.throws(() => parseArgs(["--session", "pi-sub-0199a1b2", "--dir", "/tmp/pi-sub-ffffffff", ...rest]), /different ids/);
});
