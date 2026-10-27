import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Card, checkCard, HANDOFF_MAX_CHARS, render } from "./card.ts";
import { gitFacts, jobFacts } from "./facts.ts";
import { lastHandoff, saveHandoff } from "./store.ts";
import { parseEntry, type Registry, writeCard } from "./summarize.ts";
import { strip, tail } from "./transcript.ts";

const card: Card = {
  goal: "Ship the handoff",
  status: "active",
  decisions: ["Card from a cheap model"],
  open: [],
  next: "Write tests",
  avoid: [],
  done: ["#90 handoff card"],
};

test("strip keeps text and one line per tool call with the first result line, without output or thinking", () => {
  const lines = strip([
    { id: "1", type: "message", message: { role: "user", content: "Build   the card" } },
    {
      id: "2",
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", text: "secret" },
          { type: "text", text: "Running checks." },
          { type: "toolCall", id: "c1", name: "bash", arguments: { command: "just check" } },
        ],
      },
    },
    { id: "3", type: "message", message: { role: "toolResult", toolCallId: "c1", isError: true, content: [{ type: "text", text: "exit 1\nlong output" }] } },
    { id: "4", type: "custom_message", customType: "bash-job", content: "job 3: exit 0" },
  ]);
  assert.deepEqual(lines, ["user: Build the card", "assistant: Running checks.", "bash: just check → error: exit 1", "event bash-job: job 3: exit 0"]);
  assert.deepEqual(tail(["aaaa", "bbbb", "cccc"], 10), ["bbbb", "cccc"]);
});

test("checkCard accepts a valid card and names every invalid field", () => {
  assert.equal(checkCard(card), card);
  assert.throws(() => checkCard({ ...card, status: "half", decisions: Array(6).fill("x"), next: "" }), /status: .*next: .*decisions: at most 5/);
  assert.throws(() => checkCard(null), /not an object/);
});

test("render puts card, facts, recent lines and source in the handoff and fails above the limit", () => {
  const text = render(card, ["branch: main"], ["user: hi"], "/s.jsonl");
  assert.match(
    text,
    /^# Handoff\nGoal: Ship the handoff\nStatus: active\nNext: Write tests\nDecisions:\n- Card from a cheap model\nDone:\n- #90 handoff card\nState:\n- branch: main\nLast actions:\n- user: hi\nEarlier work: \/s\.jsonl$/,
  );
  assert.throws(() => render(card, ["x".repeat(HANDOFF_MAX_CHARS)], [], "/s"), /more than 32000/);
});

test("writeCard walks the ladder until a model returns a valid write_card call", async () => {
  const calls: string[] = [];
  const registry: Registry = {
    find: (p, id) => (id === "missing" ? undefined : `${p}/${id}`),
    hasConfiguredAuth: (m) => m !== "a/noauth",
    complete: async (m: any) => {
      calls.push(m);
      if (m === "a/broken") return { stopReason: "error", errorMessage: "down", content: [] };
      if (m === "a/text") return { stopReason: "stop", content: [{ type: "text" }] };
      if (m === "a/bad") return { stopReason: "toolUse", content: [{ type: "toolCall", name: "write_card", arguments: { goal: "" } }] };
      return { stopReason: "toolUse", content: [{ type: "toolCall", name: "write_card", arguments: card }] };
    },
  };
  const result = await writeCard(registry, ["a/missing", "a/noauth", "a/broken", "a/text", "a/bad", "a/good:low"], undefined, ["user: hi"]);
  assert.deepEqual(result, { card, model: "a/good:low" });
  assert.deepEqual(calls, ["a/broken", "a/text", "a/bad", "a/good"]);
  await assert.rejects(
    writeCard(registry, ["a/missing", "a/broken"], undefined, []),
    /no model wrote a valid card\. a\/missing: not in the pi model registry; a\/broken: down/,
  );
  assert.deepEqual(parseEntry("p/m:high"), { provider: "p", id: "m", thinking: "high" });
  assert.throws(() => parseEntry("nope"), /not "provider\/id\[:thinking\]"/);
});

test("gitFacts reads branch, dirty files, worktrees and PRs, and names a failing command", () => {
  const exec = (_cmd: string, args: string[]) => {
    if (args[0] === "branch") return "feat";
    if (args[0] === "status") return " M a.ts\n?? b.ts";
    if (args[0] === "worktree") return "/r abc [main]\n/w/x def [x]";
    throw Object.assign(new Error("boom"), { stderr: "gh: not logged in" });
  };
  assert.deepEqual(gitFacts("/r", exec), [
    "branch: feat in /r",
    "dirty files (2): a.ts, b.ts",
    "worktrees: /w/x",
    "open PRs: unknown (gh failed: gh: not logged in)",
  ]);
  const local = (_cmd: string, args: string[]) => {
    if (args[0] === "pr") throw Object.assign(new Error("x"), { stderr: "no git remotes found" });
    return args[0] === "branch" ? "main" : "";
  };
  assert.deepEqual(gitFacts("/l", local), ["branch: main in /l"]);
  assert.deepEqual(
    gitFacts("/x", () => {
      throw new Error("no git");
    }),
    ["git: not a repository (/x)"],
  );
});

test("jobFacts lists background jobs without a report, and handoff files keep their order", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  mkdirSync(join(dir, "jobs"));
  const job = (id: string, extra: object) =>
    writeFileSync(join(dir, "jobs", `${id}.json`), JSON.stringify({ id, command: "sleep 9", bg: true, status: join(dir, `${id}.status`), ...extra }));
  job("1", { reported: true });
  job("2", {});
  job("3", { bg: false });
  assert.deepEqual(jobFacts(dir), ["bash jobs: 2 (running): sleep 9"]);
  assert.equal(lastHandoff(dir), undefined);
  const h = { card, model: "m", facts: [], recent: [], text: "t", untilEntry: "e1", createdAt: "now" };
  saveHandoff(dir, h);
  assert.match(saveHandoff(dir, { ...h, untilEntry: "e2" }), /handoff\/2\.json$/);
  assert.equal(lastHandoff(dir)?.untilEntry, "e2");
  writeFileSync(join(dir, "handoff", "3.json"), "{");
  assert.throws(() => lastHandoff(dir), /cannot read .*3\.json/);
});
