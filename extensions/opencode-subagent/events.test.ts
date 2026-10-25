import { describe, expect, test } from "bun:test";
import { applyEvent, emptyRun, parseModels, report } from "./events.ts";

const line = (event: object) => JSON.stringify({ sessionID: "ses_1", timestamp: 1, ...event });

describe("OpenCode events", () => {
  test("collects text, tools, usage and the session", () => {
    const run = emptyRun();
    const progress = [
      line({ type: "step_start", part: { type: "step-start" } }),
      line({ type: "tool_use", part: { tool: "shell", state: { status: "completed", input: { command: "git status --short" }, output: "" } } }),
      line({
        type: "tool_use",
        part: { tool: "shell", state: { status: "error", input: { command: "git commit -am x" }, error: "Permission denied: shell" } },
      }),
      line({ type: "step_finish", part: { cost: 0.5, tokens: { input: 10, output: 2, cache: { read: 7 } } } }),
      line({ type: "step_finish", part: { cost: 0.25, tokens: { input: 1, output: 3 } } }),
      line({ type: "text", part: { text: " DONE \n" } }),
    ].map((l) => applyEvent(run, l));
    expect(progress).toEqual([
      undefined,
      'shell {"command":"git status --short"}',
      'shell {"command":"git commit -am x"} → Permission denied: shell',
      undefined,
      undefined,
      undefined,
    ]);
    expect(run.session).toBe("ses_1");
    expect(run.text).toEqual(["DONE"]);
    expect(run.tokens).toEqual({ input: 11, output: 5, cacheRead: 7 });
    expect(run.cost).toBe(0.75);
    expect(report(run)).toBe(
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
    expect(run.errors).toEqual(["rate limited", "plain", '{"code":3}']);
  });

  test("shortens long tool input and ignores blank lines", () => {
    const run = emptyRun();
    expect(applyEvent(run, "  ")).toBeUndefined();
    const progress = applyEvent(run, line({ type: "tool_use", part: { tool: "edit", state: { status: "completed", input: { text: "x".repeat(500) } } } }));
    expect(progress?.length).toBeLessThanOrEqual(5 + 120);
    expect(progress?.endsWith("…")).toBe(true);
  });

  test("rejects a line that is not JSON", () => {
    expect(() => applyEvent(emptyRun(), "not json")).toThrow("invalid line: not json");
  });

  test("reads model IDs and skips other output", () => {
    expect(parseModels("opencode/big-pickle\nopencode-go/glm-5.3\n\nWarning: something\n  opencode/deepseek-v4.1-flash-free  \n")).toEqual([
      "opencode/big-pickle",
      "opencode-go/glm-5.3",
      "opencode/deepseek-v4.1-flash-free",
    ]);
  });
});
