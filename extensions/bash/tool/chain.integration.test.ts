import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { onRoutePart } from "../../../shared/route.ts";
import { formatOutput, routeChain } from "./chain.ts";

function run(command: string) {
  const pi = { events: createEventBus() };
  onRoutePart(pi, (part) => (part.startsWith("show ") ? { command: part.replace("show", "echo"), format: (out, exit) => `[${exit}] ${out}` } : undefined));
  const routed = routeChain(pi, command)!;
  const r = spawnSync("bash", ["-c", `show() { :; }\n${routed.script}`], { encoding: "utf8", cwd: "/" });
  return { out: formatOutput(r.stdout + r.stderr, routed), code: r.status };
}

test("the shell keeps cd and the chain logic, and each routed part gets its own exit", () => {
  assert.deepEqual(run("cd /tmp && show $PWD; false || show no; show x && false && show never"), {
    out: "[0] /tmp\n[0] no\n[0] x\n",
    code: 1,
  });
});

test("a routed part with a heredoc or a comment stays closed", () => {
  assert.deepEqual(run("show a # note\nshow b; cat <<EOF\nq\nEOF\nshow c"), { out: "[0] a\n[0] b\nq\n[0] c\n", code: 0 });
});

test("the exit of a failed routed part decides the chain", () => {
  const pi = { events: createEventBus() };
  onRoutePart(pi, (part) => (part === "fail" ? { command: "echo bad; exit 3", format: (out, exit) => `${out} (${exit})` } : undefined));
  const routed = routeChain(pi, "fail || echo after; echo end")!;
  const r = spawnSync("bash", ["-c", routed.script], { encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.equal(formatOutput(r.stdout, routed), "bad\n");
});
