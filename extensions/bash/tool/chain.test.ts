import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { onRoutePart, routedChain } from "../../../shared/route.ts";
import { formatOutput, registerChainRouting, routeChain } from "./chain.ts";

function api() {
  const pi = { events: createEventBus() };
  registerChainRouting(pi);
  onRoutePart(pi, (part) => {
    if (part === "git log") return { command: "git --no-pager log --oneline", format: (out, exit) => `log ${exit}: ${out.toUpperCase()}` };
    if (part === "git add .") return { command: "git add -A" };
    return undefined;
  });
  return pi;
}

test("bash tells the guards that it routes chains", () => {
  assert.equal(routedChain(api(), "cd a && ls"), true);
});

test("a routed part runs between markers, and the other parts stay as they are", () => {
  const r = routeChain(api(), "cd x && git log; git add . && git log & ls")!;
  assert.equal(r.script.startsWith("cd x && { printf '\\036"), true);
  assert.match(r.script, /; git --no-pager log --oneline\n__pi_exit=\$\?; .*\(exit "\$__pi_exit"\); \}; git add -A && git log & ls$/);
  assert.deepEqual([...r.formats.keys()], [1]);
});

test("no routed part gives undefined, and a single command is routed too", () => {
  assert.equal(routeChain(api(), "cd x && ls"), undefined);
  assert.equal(routeChain(api(), "ls"), undefined);
  assert.deepEqual([...routeChain(api(), "git log")!.formats.keys()], [0]);
});

test("the output of a routed part goes through its format, and the markers go", () => {
  const r = routeChain(api(), "echo a; git log; echo b")!;
  const out = `a\n\x1e${r.nonce}:1\nabc\ndef\n\n\x1e${r.nonce}:1:0\nb\n`;
  assert.equal(formatOutput(out, r), "a\nlog 0: ABC\nDEF\nb\n");
  assert.equal(formatOutput(`\x1e${r.nonce}:1\nhalf`, r), "half");
});
