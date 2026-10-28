import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type Card, checkCard, HANDOFF_MAX_CHARS, openPrNumbers, render } from "./card.ts";
import { decide, warmDecision, warning } from "./decider.ts";
import { gitFacts, jobFacts, systemFacts } from "./facts.ts";
import { ask, readSession, select } from "./recall.ts";
import { lastHandoff, saveHandoff } from "./store.ts";
import { parseEntry, prompt, type Registry, writeCard } from "./summarize.ts";
import { strip } from "./transcript.ts";
import { UPDATE_CHARS, updateReasons } from "./triggers.ts";

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
});

test("checkCard accepts a valid card and names every invalid field", () => {
  assert.equal(checkCard(card), card);
  assert.throws(
    () => checkCard({ ...card, status: "half", waitsForUser: "no", state: [{ now: "x" }], decisions: Array(4).fill("x"), next: [] }),
    /status: .*waitsForUser: .*state: .*decisions: at most 3.*next: at least 1/,
  );
  assert.throws(() => checkCard(null), /not an object/);
  assert.throws(() => checkCard({ ...card, status: "done" }), /status done with open work/);
  assert.throws(() => checkCard({ ...card, open: ["#7 x"], merged: ["#8 y", "Nixos#9 z"] }, [8, 9]), /open: #7 is not open.*merged: #8 is still open/);
  assert.equal(checkCard({ ...card, open: ["#7 x"] }, undefined).open[0], "#7 x");
  assert.deepEqual(openPrNumbers(["open PRs in this repository (all sessions): #1 a (branch b, checks green); #22 c (branch d, checks red)"]), [1, 22]);
  assert.equal(openPrNumbers(["open PRs: unknown (gh failed: x)"]), undefined);
  assert.deepEqual(openPrNumbers(["open PRs in this repository (all sessions): none"]), []);
});

test("render puts next actions, state now and target, open, merged, facts and source in the handoff and fails above the limit", () => {
  assert.equal(
    render(card, ["branch: main"], "/s.jsonl"),
    [
      "# Handoff",
      "Goal: Ship the handoff",
      "Status: active",
      "Resume: go on at once with Next 1, without a question to the user",
      "Next:",
      "1. Merge #102",
      "2. Rebuild gaia",
      "State:",
      "- now: package 0.16.0 installed → must be: package 0.17.0 installed",
      "- main clean (correct)",
      "Open:",
      "- #102 short card: checks green",
      "Merged:",
      "- #90 handoff card",
      "Decisions:",
      "- Card from a cheap model",
      "Facts:",
      "- branch: main",
      "Earlier work: /s.jsonl",
    ].join("\n"),
  );
  assert.throws(() => render(card, ["x".repeat(HANDOFF_MAX_CHARS)], "/s"), /more than 8000/);
});

test("prompt gives the facts, the previous card and the transcript to the card model", () => {
  assert.equal(
    prompt(undefined, ["branch: main"], ["user: hi"]),
    "Facts now:\nbranch: main\n\nPrevious card:\n(none)\n\nTranscript since the previous card:\nuser: hi",
  );
});

test("systemFacts names the active system and its config revision, and names a failing command", () => {
  const exec = (cmd: string) => (cmd === "readlink" ? "/nix/store/abc-nixos-system" : '{"configurationRevision":"0123456789ab-dirty"}');
  assert.deepEqual(systemFacts(exec), ["system: /nix/store/abc-nixos-system (config revision 01234567, dirty)"]);
  const noVersion = (cmd: string) => {
    if (cmd === "readlink") return "/nix/store/abc";
    throw new Error("not found");
  };
  assert.deepEqual(systemFacts(noVersion), ["system: /nix/store/abc", "system revision: unknown (nixos-version failed: not found)"]);
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
  const result = await writeCard(registry, ["a/missing", "a/noauth", "a/broken", "a/text", "a/bad", "a/good:low"], undefined, [], ["user: hi"]);
  assert.deepEqual(result, { card, model: "a/good:low" });
  assert.deepEqual(calls, ["a/broken", "a/text", "a/bad", "a/bad", "a/good"]);
  await assert.rejects(
    writeCard(registry, ["a/missing", "a/broken"], undefined, [], []),
    /no model wrote a valid card\. a\/missing: not in the pi model registry; a\/broken: down/,
  );
  const seen: unknown[][] = [];
  const fixes: Registry = {
    find: (p, id) => `${p}/${id}`,
    hasConfiguredAuth: () => true,
    complete: async (_m, context: any) => {
      seen.push([...context.messages]);
      const open = seen.length === 1 ? ["#93 shorter text"] : ["#105 short card"];
      return { stopReason: "toolUse", content: [{ type: "toolCall", name: "write_card", arguments: { ...card, open, merged: [] } }] };
    },
  };
  const fixed = await writeCard(fixes, ["a/m"], undefined, ["open PRs in this repository (all sessions): #105 x (branch y, checks green)"], []);
  assert.deepEqual(fixed.card.open, ["#105 short card"]);
  assert.match(String((seen[1][1] as any).content), /open: #93 is not open on GitHub/);
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
    "worktrees: /w/x (x)",
    "open PRs: unknown (gh failed: gh: not logged in)",
  ]);
  const local = (_cmd: string, args: string[]) => {
    if (args[0] === "pr") throw Object.assign(new Error("x"), { stderr: "no git remotes found" });
    return args[0] === "branch" ? "main" : "";
  };
  assert.deepEqual(gitFacts("/l", local), ["branch: main in /l"]);
  const withPr = (_cmd: string, args: string[]) => (args[0] === "branch" ? "main" : args[0] === "pr" ? "#7 x (branch x, checks green)" : "");
  const noPr = (_cmd: string, args: string[]) => (args[0] === "branch" ? "main" : "");
  assert.deepEqual(gitFacts("/n", noPr), ["branch: main in /n", "open PRs in this repository (all sessions): none"]);
  assert.deepEqual(gitFacts("/p", withPr), ["branch: main in /p", "open PRs in this repository (all sessions): #7 x (branch x, checks green)"]);
  assert.deepEqual(
    gitFacts("/x", () => {
      throw new Error("no git");
    }),
    ["git: not a repository (/x)"],
  );
});

test("jobFacts lists background jobs without a report, and handoff files keep their order", () => {
  const dir = mkdtempSync(join(tmpdir(), "handoff-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
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

test("updateReasons: 20k characters, or a successful commit, push, PR create or PR merge", () => {
  const call = (id: string, command: string) => ({
    id: `a${id}`,
    type: "message",
    message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] },
  });
  const result = (id: string, isError = false) => ({ id: `r${id}`, type: "message", message: { role: "toolResult", toolCallId: id, isError, content: "ok" } });
  const entries = [
    call("1", "git add -A && git commit -qm 'x'"),
    result("1"),
    call("2", "git push -u origin b"),
    result("2", true),
    call("3", "gh pr create -t x"),
    result("3"),
    call("4", "echo git log; gh pr merge 5"),
    result("4"),
  ];
  assert.deepEqual(updateReasons(entries, ["short"]), ["commit", "PR created", "PR merged"]);
  assert.deepEqual(updateReasons([], ["x".repeat(UPDATE_CHARS)]), [`${UPDATE_CHARS + 1} characters`]);
  assert.deepEqual(updateReasons([call("5", "git status"), result("5")], ["x"]), []);
  const background = {
    id: "r6",
    type: "message",
    message: { role: "toolResult", toolCallId: "6", content: [{ type: "text", text: "job 3.1-C1: running · log: out:3.1-C1.bash" }] },
  };
  assert.deepEqual(updateReasons([call("6", "git push"), background], ["x"]), []);
});

test("decide: warnings at 130k and 140k on turn_end, cut in the middle of the work from 150k or on request, at the end of a run after a warning, hard cut from 170k", () => {
  assert.deepEqual(decide(120_000, "turn_end", 0, false, false, false), { action: "none" });
  assert.deepEqual(decide(131_000, "turn_end", 0, false, false, false), { action: "warn", level: 1 });
  assert.deepEqual(decide(135_000, "turn_end", 1, false, false, false), { action: "none" });
  assert.deepEqual(decide(141_000, "turn_end", 1, false, false, false), { action: "warn", level: 2 });
  assert.deepEqual(decide(155_000, "turn_end", 2, false, false, false), { action: "none" });
  assert.deepEqual(decide(155_000, "settle", 2, false, false, false), { action: "cut", why: "context 155k at the end of the run" });
  assert.deepEqual(decide(155_000, "settle", 2, true, false, false), { action: "none" });
  assert.deepEqual(decide(142_000, "settle", 1, false, false, false), { action: "cut", why: "context 142k at the end of the run after the warning" });
  assert.deepEqual(decide(142_000, "settle", 1, true, false, false), { action: "none" });
  assert.deepEqual(decide(142_000, "settle", 0, false, false, false), { action: "none" });
  assert.deepEqual(decide(171_000, "turn_end", 2, true, false, false), { action: "cut", why: "context 171k over the hard limit of 170k" });
  assert.deepEqual(decide(133_000, "turn_end", 1, false, true, false), { action: "none" }, "after a warning the agent continues working");
  assert.deepEqual(decide(151_000, "turn_end", 2, false, true, false), { action: "cut", why: "context 151k in the middle of the work" });
  assert.deepEqual(decide(151_000, "turn_end", 2, true, true, false), { action: "none" });
  assert.deepEqual(decide(133_000, "turn_end", 0, false, true, false), { action: "warn", level: 1 });
  assert.deepEqual(decide(90_000, "turn_end", 0, false, true, true), { action: "cut", why: "context 90k, the agent called handoff" });
  assert.deepEqual(decide(90_000, "turn_end", 0, true, true, true), { action: "none" });
  assert.deepEqual(decide(90_000, "turn_end", 0, false, false, true), { action: "none" }, "a final answer is no cut in the middle of the work");
  assert.deepEqual(decide(90_000, "settle", 0, false, false, true), { action: "cut", why: "context 90k at the end of the run, the agent called handoff" });
  assert.equal(warning(132_000), "System: context 88%; 18k tokens left. Continue working or call handoff for an early handoff.");
  assert.equal(warning(155_000), "System: context 103%; 0k tokens left. Continue working or call handoff for an early handoff.");
  assert.equal(warmDecision(60_000, true), "warm");
  assert.equal(warmDecision(60_000, false), undefined);
  assert.equal(warmDecision(120_000, true), undefined);
});

test("recall: readSession keeps messages and fails loud on a bad file; select keeps the chunks with the words of the question", async () => {
  const dir = mkdtempSync(join(tmpdir(), "recall-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
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

test("strip: textMax sets the length per message; the default stays 500", () => {
  const long = [{ id: "1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "a".repeat(3000) }] } }];
  assert.equal(strip(long)[0].length, "assistant: ".length + 501);
  assert.equal(strip(long, { textMax: 2000 })[0].length, "assistant: ".length + 2001);
});
