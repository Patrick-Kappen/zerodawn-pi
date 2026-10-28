import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findings, scan } from "./findings.ts";

let n = 0;
/** One tool call and its result as pi session entries. */
const call = (name: string, args: Record<string, unknown>, result: string) => {
  const id = `c${n++}`;
  return [
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] } },
    { type: "message", message: { role: "toolResult", toolCallId: id, content: [{ type: "text", text: result }] } },
  ];
};
const RED = "Check commands in bash give a short result. Do not run the same check in another form. Result:\nred: exit 1 · 0.1 s\nlog: /s/out/1.check.log";

test("findings: the agent reads the check log after a check result", () => {
  const entries = [...call("bash", { command: "tsc -p ." }, RED), ...call("read", { path: "/s/out/1.check.log" }, "…")];
  assert.deepEqual(findings(entries), [{ kind: "log read", command: "tsc -p .", detail: "/s/out/1.check.log" }]);
});

test("findings: the agent runs the same linter again with a pipe, and gets the normal bash result", () => {
  const entries = [...call("bash", { command: "cd x && biome lint ." }, RED), ...call("bash", { command: "biome lint . 2>&1 | tail -5" }, "exit 0 (0s)")];
  assert.deepEqual(findings(entries), [
    { kind: "rerun in another form", command: "cd x && biome lint .", detail: "biome lint . 2>&1 | tail -5" },
    { kind: "linter without short result", command: "biome lint . 2>&1 | tail -5", detail: "exit 0 (0s)" },
  ]);
});

test("findings: a linter that got the normal bash result; not a word in an argument", () => {
  const entries = [
    ...call("bash", { command: "nix develop . -c nixfmt f.nix" }, "exit 1 (2s)\nf.nix: not formatted"),
    ...call("bash", { command: "grep biome x" }, "exit 0 (0s)"),
  ];
  assert.deepEqual(findings(entries), [{ kind: "linter without short result", command: "nix develop . -c nixfmt f.nix", detail: "exit 1 (2s)" }]);
});

test("findings: none for a check result that the agent used as it is", () => {
  const entries = [...call("bash", { command: "tsc" }, RED), ...call("edit", { path: "a.ts" }, "ok")];
  assert.deepEqual(findings(entries), []);
});

test("scan: findings of the transcripts and the anomalies files, grouped and counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "findings-"));
  try {
    mkdirSync(join(dir, "p", "s1"), { recursive: true });
    const entries = [...call("bash", { command: "tsc" }, RED), ...call("read", { path: "/s/out/1.check.log" }, "…")];
    writeFileSync(join(dir, "p", "s1.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n"));
    writeFileSync(
      join(dir, "p", "s1", "check-anomalies.jsonl"),
      `${JSON.stringify({ signals: ["fallback"], command: "just lint", log: "/s/out/2.check.log" })}\n`,
    );
    assert.equal(scan(dir, new Date(0)), "anomaly: fallback: 1\n  just lint\n    → /s/out/2.check.log\n\nlog read: 1\n  tsc\n    → /s/out/1.check.log");
    assert.match(scan(dir, new Date(Date.now() + 86400000)), /^no findings since /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scan: a missing directory is an error that names it", () => {
  assert.throws(() => scan("/no/such/dir", new Date(0)), /no session directory \/no\/such\/dir/);
});
