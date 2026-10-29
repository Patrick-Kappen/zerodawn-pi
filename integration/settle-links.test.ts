import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import bash from "../extensions/bash/index.ts";
import handoff from "../extensions/handoff/index.ts";
import lsp from "../extensions/lsp/index.ts";
import tests from "../extensions/tests/index.ts";
import { createHarness, extensionLoadOrder, waitFor } from "./harness.ts";

/** Locks the links at agent_before_settle between bash, checker, handoff, lsp and tests, in load order. No model is called. */

const scratch = mkdtempSync(join(tmpdir(), "settle-links-"));
const config = join(scratch, "config.json");
writeFileSync(config, JSON.stringify({ handoffModels: ["fake/model"] }));
const ENV = {
  ZERODAWN_PI_CONFIG: config,
  PI_LSP_SERVER: "fake-socket", // lsp registers its handler only with a socket; it acts only in print and json mode
  PI_CHECKER_LOG: join(scratch, "checker.jsonl"),
};
const previous = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
Object.assign(process.env, ENV);
const checker = (await import(
  `${new URL("../extensions/checker/index.ts", import.meta.url).href}?links=${Date.now()}`
)) as typeof import("../extensions/checker/index.ts");
after(() => {
  rmSync(scratch, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ALL: Record<string, (pi: any) => void> = { bash, checker: checker.default, handoff, lsp, tests };
const order = extensionLoadOrder().filter((name) => name in ALL);

const settledAnswers = {
  status: { type: "choice", choice: "done", confidence: 0.9 },
  open_error: { type: "bool", probability: 0.05 },
  in_scope: { type: "bool", probability: 0.05 },
  question_answerable: { type: "bool", probability: 0.05 },
  next_step_offered: { type: "bool", probability: 0.05 },
  unchecked: { type: "bool", probability: 0.05 },
  completeness: { type: "score", score: 3, confidence: 0.9 },
  rule_violation: { type: "bool", probability: 0.05 },
};

const card = {
  goal: "Finish the job",
  status: "active",
  waitsForUser: false,
  inProgress: [],
  state: [],
  next: ["Report the result"],
  merged: [],
  open: [],
  decisions: [],
  avoid: [],
};

function make() {
  const root = mkdtempSync(join(tmpdir(), "settle-links-run-"));
  const classifyCalls: any[] = [];
  const modelRegistry = {
    findOfType: (type: string, provider: string, id: string) => ({ type, provider, id }),
    classify: async (_model: any, request: any) => {
      classifyCalls.push(request);
      return { stopReason: "stop", answers: settledAnswers };
    },
    find: (provider: string, id: string) => ({ provider, id }),
    hasConfiguredAuth: () => true,
    complete: async () => ({ stopReason: "stop", content: [{ type: "toolCall", name: "write_card", arguments: card }] }),
  };
  const h = createHarness({ root, modelRegistry, extensions: order.map((name) => ({ name, register: ALL[name] })) });
  const branch: any[] = [];
  const user = (text: string) => branch.push({ id: `u${branch.length}`, type: "message", message: { role: "user", content: text } });
  const answer = (text: string) => branch.push({ id: `a${branch.length}`, type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
  h.setBranch(branch);
  const running = () => {
    const query = { running: false };
    h.events.emit(checker.BACKGROUND_JOBS_QUERY, query);
    return query.running;
  };
  /** Starts a real background bash job that ends when the gate file exists. */
  const startJob = async (gate: string) => {
    const command = `while [ ! -e '${gate}' ]; do sleep 0.02; done; echo job done`;
    user("Start the gated job.");
    branch.push({
      id: "call",
      type: "message",
      message: {
        role: "assistant",
        // A second tool call in the message: a bash call alone in its message waits for its result inline.
        content: [
          { type: "toolCall", id: "job-call", name: "bash", arguments: { command } },
          { type: "toolCall", id: "job-read", name: "read", arguments: { path: "README.md" } },
        ],
      },
    });
    const result = await h.tools.get("bash").execute("job-call", { command }, undefined, undefined, h.ctx);
    assert.equal(result.details.background, true);
    branch.push({
      id: "res",
      type: "message",
      message: { role: "toolResult", toolCallId: "job-call", toolName: "bash", isError: false, content: result.content },
    });
    answer("Waiting for the background job.");
  };
  return { root, h, branch, classifyCalls, running, startJob, user, answer };
}

test("agent_before_settle handlers run in the load order bash, checker, handoff, lsp, tests", () => {
  const { h } = make();
  assert.deepEqual(h.owners("agent_before_settle"), ["bash", "checker", "handoff", "lsp", "tests"]);
});

test("with an open bash job the checker does not classify and nothing is added", async () => {
  const s = make();
  try {
    const gate = join(s.root, "gate");
    await s.startJob(gate);
    await waitFor(s.running, "the job to run");
    s.h.setTokens(10_000);
    const out = await s.h.settle();
    assert.equal(s.classifyCalls.length, 0);
    assert.deepEqual(out, { entries: [], continue: false });
    writeFileSync(gate, "");
  } finally {
    await s.h.close();
  }
});

test("with no open work the checker classifies once and adds its entry for the handlers after it", async () => {
  const s = make();
  try {
    s.user("Say hi.");
    s.answer("Hi.");
    s.h.setTokens(10_000);
    const out = await s.h.settle();
    assert.equal(s.classifyCalls.length, 1);
    assert.equal(out.entries.length, 1);
    assert.equal(out.entries[0].customType, "checker");
    assert.equal(out.continue, false);
  } finally {
    await s.h.close();
  }
});

test("handoff does not cut while a bash job runs, and cuts after the job ended; it sees the checker entry before it", async () => {
  const s = make();
  try {
    const gate = join(s.root, "gate");
    await s.startJob(gate);
    await waitFor(s.running, "the job to run");
    s.h.setTokens(160_000);
    const during = await s.h.settle();
    assert.equal(s.classifyCalls.length, 0);
    assert.deepEqual(during.entries, [], "no compaction while the job runs");
    assert.equal(s.h.notes.filter((n) => n.includes("handoff:")).length, 0);

    writeFileSync(gate, "");
    await waitFor(() => !s.running(), "the job to end");
    const after = await s.h.settle();
    assert.equal(s.classifyCalls.length, 1);
    assert.deepEqual(
      after.entries.map((e: any) => e.customType ?? e.type),
      ["checker", "compaction"],
    );
    assert.match(after.entries[1].summary, /^# Handoff/);
    assert.equal(after.continue, false);
  } finally {
    await s.h.close();
  }
});
