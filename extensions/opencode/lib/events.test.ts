import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyEvent, emptyRun, parseModels, report } from "./events.ts";

const line = (event: object) => JSON.stringify({ sessionID: "ses_1", timestamp: 1, ...event });

describe("OpenCode events", () => {
  test("collects text, tools, usage and the session", () => {
    const run = emptyRun();
    for (const l of [
      line({ type: "step_start", part: { type: "step-start" } }),
      line({ type: "tool_use", part: { tool: "shell", state: { status: "completed", input: { command: "git status --short" }, output: "" } } }),
      line({
        type: "tool_use",
        part: { tool: "shell", state: { status: "error", input: { command: "git commit -am x" }, error: "Permission denied: shell" } },
      }),
      line({ type: "step_finish", part: { cost: 0.5, tokens: { input: 10, output: 2, cache: { read: 7 } } } }),
      line({ type: "step_finish", part: { cost: 0.25, tokens: { input: 1, output: 3 } } }),
      line({ type: "text", part: { text: " DONE \n" } }),
    ])
      applyEvent(run, l);
    assert.equal(run.session, "ses_1");
    assert.deepEqual(run.text, ["DONE"]);
    assert.deepEqual(run.tokens, { input: 11, output: 5, cacheRead: 7 });
    assert.equal(run.cost, 0.75);
    assert.equal(
      report(run),
      [
        "DONE",
        "",
        "OpenCode tools:",
        '- shell {"command":"git status --short"}',
        '- shell {"command":"git commit -am x"} → error: Permission denied: shell',
        "",
        "Session: ses_1",
      ].join("\n"),
    );
  });

  test("keeps error events with their message", () => {
    const run = emptyRun();
    applyEvent(run, line({ type: "error", error: { name: "APIError", data: { message: "rate limited" } } }));
    applyEvent(run, line({ type: "error", error: "plain" }));
    applyEvent(run, line({ type: "error", error: { code: 3 } }));
    assert.deepEqual(run.errors, ["rate limited", "plain", '{"code":3}']);
  });

  test("shortens long tool input and ignores blank lines", () => {
    const run = emptyRun();
    applyEvent(run, "  ");
    applyEvent(run, line({ type: "tool_use", part: { tool: "edit", state: { status: "completed", input: { text: "x".repeat(500) } } } }));
    assert.equal(run.tools.length, 1);
    assert.equal(run.tools[0].input.length, 120);
    assert.ok(run.tools[0].input.endsWith("…"));
  });

  test("rejects a line that is not JSON", () => {
    assert.throws(() => applyEvent(emptyRun(), "not json"), /invalid line: not json/);
  });

  test("reads model IDs and skips other output", () => {
    assert.deepEqual(parseModels("opencode/big-pickle\nopencode-go/glm-5.3\n\nWarning: something\n  opencode/deepseek-v4.1-flash-free  \n"), [
      "opencode/big-pickle",
      "opencode-go/glm-5.3",
      "opencode/deepseek-v4.1-flash-free",
    ]);
  });
});
