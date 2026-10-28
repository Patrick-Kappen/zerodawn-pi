import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import bashExtension from "../extensions/bash/index.ts";

const logRoot = mkdtempSync(join(tmpdir(), "background-checker-log-"));
const logFile = join(logRoot, "checker.jsonl");
const previousLog = process.env.PI_CHECKER_LOG;
process.env.PI_CHECKER_LOG = logFile;
const checker = (await import(
  `${new URL("../extensions/checker/index.ts", import.meta.url).href}?integration=${Date.now()}`
)) as typeof import("../extensions/checker/index.ts");
if (previousLog === undefined) delete process.env.PI_CHECKER_LOG;
else process.env.PI_CHECKER_LOG = previousLog;
after(() => rmSync(logRoot, { recursive: true, force: true }));

const settled = () => ({
  status: { type: "choice", choice: "done", confidence: 0.9 },
  open_error: { type: "bool", probability: 0.05 },
  in_scope: { type: "bool", probability: 0.05 },
  question_answerable: { type: "bool", probability: 0.05 },
  next_step_offered: { type: "bool", probability: 0.05 },
  unchecked: { type: "bool", probability: 0.05 },
  completeness: { type: "score", score: 3, confidence: 0.9 },
  rule_violation: { type: "bool", probability: 0.05 },
});

const unfinished = () => ({
  ...settled(),
  status: { type: "choice", choice: "incomplete", confidence: 0.9 },
});

type Handler = (event: any, ctx?: any) => unknown;
type Harness = Awaited<ReturnType<typeof createHarness>>;

async function waitFor(check: () => boolean, what: string, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await delay(10);
  }
  throw new Error(`${what} did not happen within ${timeout} ms`);
}

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "background-checker-"));
  const events = createEventBus();
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();
  const sent: any[] = [];
  const classifyCalls: any[] = [];
  let answers: Record<string, any> = settled();
  const branch: any[] = [];

  const dispatch = async (name: string, event: any, ctx?: any) => {
    let result: any;
    for (const handler of handlers.get(name) ?? []) {
      const current = await handler(event, ctx);
      if (current !== undefined) result = current;
    }
    return result;
  };

  const api = {
    events,
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => {
        handlers.set(
          name,
          (handlers.get(name) ?? []).filter((h) => h !== handler),
        );
      };
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerShortcut() {},
    registerCommand() {},
    registerToolRenderer() {},
    registerMessageRenderer() {},
    registerEntryRenderer() {},
    sendMessage(message: any) {
      sent.push(message);
    },
  } as any;

  const notes: string[] = [];
  const ctx = {
    cwd: root,
    mode: "tui",
    hasUI: true,
    ui: {
      theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
      notify: (message: string, level?: string) => notes.push(`${level ?? "info"}: ${message}`),
      setStatus() {},
      setWidget() {},
      select: async () => undefined,
    },
    sessionManager: {
      getSessionFile: () => join(root, "session.jsonl"),
      getSessionId: () => "background-checker",
      getBranch: () => branch,
    },
    modelRegistry: {
      findOfType: (type: string, provider: string, id: string) => ({ type, provider, id }),
      classify: async (_model: any, request: any) => {
        classifyCalls.push(request);
        return { stopReason: "stop", answers };
      },
    },
    isIdle: () => true,
  } as any;

  bashExtension(api);
  checker.default(api);
  const settle = handlers.get("agent_before_settle")?.at(-1);
  const bash = tools.get("bash");
  const job = tools.get("jobs");
  if (!settle) throw new Error("checker did not register agent_before_settle");
  if (!bash) throw new Error("bash extension did not register the bash tool");
  if (!job) throw new Error("bash extension did not register the jobs tool");

  const running = () => {
    const query = { running: false };
    events.emit(checker.BACKGROUND_JOBS_QUERY, query);
    return query.running;
  };
  const reports = () => sent.filter((message) => message.customType === "bash-job");
  const start = (toolCallId: string, command: string, prompt: string) => {
    branch.push(
      { type: "message", message: { role: "user", content: prompt } },
      {
        type: "message",
        // A second tool call in the message: a bash call alone in its message waits for its result inline.
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: toolCallId, name: "bash", arguments: { command } },
            { type: "toolCall", id: `${toolCallId}-read`, name: "read", arguments: { path: "README.md" } },
          ],
        },
      },
    );
    return bash.execute(toolCallId, { command }, undefined, undefined, ctx).then((result: any) => {
      branch.push(
        { type: "message", message: { role: "toolResult", toolCallId, toolName: "bash", isError: false, content: result.content } },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Waiting for the background job." }] } },
      );
      return result;
    });
  };
  const settleCheck = () => settle({ type: "agent_before_settle", outcome: "completed", continue: false, entries: [] }, ctx) as Promise<any>;
  const deliver = async () => {
    for (const message of reports()) {
      await dispatch("message_end", { type: "message_end", message: { role: "custom", ...message } }, ctx);
    }
  };
  const waitForReport = async (id: string) => {
    await waitFor(() => reports().some((message) => message.details?.jobs === id), `report of job ${id}`);
    await deliver();
    return reports().find((message) => message.details?.jobs === id);
  };
  const close = async () => {
    await dispatch("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
    events.clear();
    await delay(100);
    rmSync(root, { recursive: true, force: true });
  };

  return {
    root,
    branch,
    notes,
    classifyCalls,
    reports,
    running,
    start,
    settle: settleCheck,
    waitForReport,
    close,
    answers: (value: Record<string, any>) => {
      answers = value;
    },
    deliver,
  };
}

const gateCommand = (gate: string, output: string, code = 0) => `while [ ! -e '${gate}' ]; do sleep 0.02; done; printf '${output}\\n'; exit ${code}`;

test("checker skips a running background job, then settles its success with the visible output and one report", async () => {
  const h: Harness = await createHarness();
  try {
    const prompt = "Start the gated job.";
    const gate = join(h.root, "success.gate");
    const started = await h.start("call-success", gateCommand(gate, "gated success"), prompt);
    const id = started.details.job as string;
    assert.equal(started.details.background, true);
    assert.match(started.content[0].text, new RegExp(`^job ${id}: running · log: .*\\.bash\\.log$`));

    await waitFor(() => h.running(), "bash to report the job as running");
    assert.equal(await h.settle(), undefined);
    assert.equal(h.classifyCalls.length, 0, "the checker must not classify while background work is unfinished");
    assert.equal(h.reports().length, 0);

    writeFileSync(gate, "");
    const report = await h.waitForReport(id);
    assert.match(report.content, new RegExp(`^job ${id}: exit 0 \\(`));
    assert.match(report.content, /gated success/);
    assert.equal(report.details.items.length, 1);
    assert.equal(report.details.items[0].id, id);
    assert.equal(report.details.items[0].ok, true);
    assert.match(report.details.items[0].status, /^exit 0 /);
    assert.equal(h.classifyCalls.length, 0);

    const outcome = await h.settle();
    assert.equal(h.classifyCalls.length, 1);
    assert.equal(h.classifyCalls[0].state.request, prompt);
    assert.equal(h.classifyCalls[0].state.finalAnswer, "Waiting for the background job.");
    assert.equal(outcome.continue, undefined);
    assert.equal(outcome.entries.length, 1);
    assert.equal(outcome.entries[0].type, "custom");
    assert.equal(outcome.entries[0].customType, "checker");
    assert.deepEqual(outcome.entries[0].data.reasons, []);
    assert.equal(h.reports().length, 1);
    await h.deliver();
    await delay(100);
    assert.equal(h.reports().length, 1, "the completed job must not be reported twice");
    assert.equal(h.notes.length, 0);
  } finally {
    await h.close();
  }
});

test("checker resumes after a failed background job, keeps its failure output, and follows up only for unfinished input", async () => {
  const h: Harness = await createHarness();
  h.answers(unfinished());
  try {
    const prompt = "Start the gated job.";
    const gate = join(h.root, "failure.gate");
    const started = await h.start("call-failure", gateCommand(gate, "gated failure", 7), prompt);
    const id = started.details.job as string;

    await waitFor(() => h.running(), "bash to report the job as running");
    assert.equal(await h.settle(), undefined);
    assert.equal(h.classifyCalls.length, 0);

    writeFileSync(gate, "");
    const report = await h.waitForReport(id);
    assert.match(report.content, new RegExp(`^job ${id}: exit 7 \\(`));
    assert.match(report.content, /gated failure/);
    assert.equal(report.details.items.length, 1);
    assert.equal(report.details.items[0].id, id);
    assert.equal(report.details.items[0].ok, false);
    assert.match(report.details.items[0].status, /^exit 7 /);

    const outcome = await h.settle();
    assert.equal(h.classifyCalls.length, 1);
    assert.equal(h.classifyCalls[0].state.request, prompt);
    assert.equal(outcome.continue, true);
    assert.equal(outcome.entries[0].customType, "checker");
    assert.equal(outcome.entries[1].type, "custom_message");
    assert.equal(outcome.entries[1].customType, "checker-followup");
    assert.equal(outcome.entries[1].content, "checker:\n- Finish the task.\nIf wrong, say why in one sentence.");
    assert.equal(h.reports().length, 1);
    await h.deliver();
    await delay(100);
    assert.equal(h.reports().length, 1, "the completed job must not be reported twice");
    assert.equal(h.notes.length, 0);
  } finally {
    await h.close();
  }
});
