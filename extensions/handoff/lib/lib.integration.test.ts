import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Card } from "./card.ts";
import { jobFacts } from "./facts.ts";
import { ask, readSession, select } from "./recall.ts";
import { lastHandoff, saveHandoff } from "./store.ts";
import type { Registry } from "./summarize.ts";

const card: Card = {
  goal: "Ship the handoff",
  status: "active",
  waitsForUser: false,
  inProgress: [],
  state: [
    { now: "package 0.16.0 installed", target: "package 0.17.0 installed" },
    { now: "main clean", target: "main clean" },
  ],
  next: ["Merge #102", "Rebuild gaia"],
  merged: ["#90 handoff card"],
  open: ["#102 short card: checks green"],
  decisions: ["Card from a cheap model"],
  avoid: [],
};

test("jobFacts lists background jobs without a report, and handoff files keep their order", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "jobs"));
  const job = (id: string, extra: object) =>
    writeFileSync(join(dir, "jobs", `${id}.json`), JSON.stringify({ id, command: "sleep 9", bg: true, status: join(dir, `${id}.status`), ...extra }));
  job("1", { reported: true });
  job("2", {});
  job("3", { bg: false });
  assert.deepEqual(jobFacts(dir), ["bash jobs: 2 (running): sleep 9"]);
  assert.equal(lastHandoff(dir), undefined);
  const h = { card, model: "m", facts: [], text: "t", untilEntry: "e1", createdAt: "now" };
  saveHandoff(dir, h);
  assert.match(saveHandoff(dir, { ...h, untilEntry: "e2" }), /handoff\/2\.json$/);
  assert.equal(lastHandoff(dir)?.untilEntry, "e2");
  writeFileSync(join(dir, "handoff", "3.json"), "{");
  assert.throws(() => lastHandoff(dir), /cannot read .*3\.json/);
});

test("recall: readSession keeps messages and fails loud on a bad file; select keeps the chunks with the words of the question", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "recall-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "s.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", id: "h" })}\n${JSON.stringify({ type: "message", id: "e1", message: { role: "user", content: "hi" } })}\n`,
  );
  assert.deepEqual(
    readSession(file).map((e) => e.id),
    ["e1"],
  );
  assert.throws(() => readSession(join(dir, "none.jsonl")), /cannot read the session file .*none\.jsonl/);
  writeFileSync(file, "{bad");
  assert.throws(() => readSession(file), /line 1 of .*s\.jsonl is not JSON/);

  const lines = Array.from({ length: 200 }, (_, i) => (i === 120 ? "assistant: we dropped job paths for out refs" : `line ${i} ${"x".repeat(40)}`));
  assert.equal(select(lines, "q", 1_000_000), lines);
  const picked = select(lines, "why job paths?", 2_500);
  assert.ok(picked.includes("assistant: we dropped job paths for out refs"));
  assert.ok(picked.join("\n").length <= 2_600);

  const registry: Registry = {
    find: (_p, id) => id,
    hasConfiguredAuth: () => true,
    complete: async (m: any) =>
      m === "empty"
        ? { stopReason: "stop", content: [{ type: "text", text: " " }] }
        : { stopReason: "stop", content: [{ type: "text", text: "Answer [e1]" } as any] },
  };
  assert.deepEqual(await ask(registry, ["p/empty", "p/good"], "q", ["[e1] user: hi"]), { answer: "Answer [e1]", model: "p/good" });
  await assert.rejects(ask(registry, ["p/empty"], "q", []), /no model answered\. p\/empty: empty answer/);
});
