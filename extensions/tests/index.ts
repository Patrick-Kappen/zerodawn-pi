import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { textOf } from "../../shared/util.ts";
import { isCheck, isTest, loadRecipes, promptText, type Recipes, Tracker } from "./lib/recipes.ts";
import { type Replacement, RunTests, TOOL } from "./lib/run.ts";

/** Bash runs this in place of a test or check command; the extension runs the command itself. */
const NO_OP = ":";

export default function (pi: ExtensionAPI) {
  let tracker = new Tracker();
  let recipes: Recipes | undefined;
  const hints = new Map<string, string>();
  const replaced = new Map<string, Promise<Replacement>>();

  const runTests = new RunTests((text) => pi.sendMessage({ customType: "run-tests", content: text, display: true }, { triggerTurn: true, deliverAs: "steer" }));

  pi.registerTool({
    ...TOOL,
    parameters: Type.Object({
      scope: Type.Optional(StringEnum(["changed", "all"] as const, { description: "changed (default): tests for the changed files. all: every test." })),
      rerun: Type.Optional(Type.Boolean({ description: "Run again when no file changed; only for a flaky test." })),
      path: Type.Optional(Type.String({ description: "Project directory, such as a git worktree. Default: the current directory." })),
    }),
    execute: (toolCallId, params, signal, _onUpdate, ctx) => runTests.execute(toolCallId, params, signal, ctx),
  });

  pi.on("session_start", () => {
    tracker = new Tracker();
    replaced.clear();
    runTests.reset();
  });

  // Print and json mode end when the agent settles, so a background result has nobody to read it: keep the run open for it.
  pi.on("agent_before_settle", async (_event, ctx) => {
    if (ctx.mode !== "print" && ctx.mode !== "json") return;
    const next = runTests.nextResult();
    if (!next) return;
    await next;
    return { continue: true };
  });

  pi.on("session_shutdown", () => {
    runTests.reset();
  });

  pi.on("before_agent_start", (event, ctx) => {
    recipes = loadRecipes(ctx.cwd);
    if (recipes) event.systemPromptOptions.sections.project_recipes = promptText(recipes);
  });

  pi.on("tool_call", (event, ctx) => {
    const input = event.input as { command?: unknown; background?: boolean };
    const command = input.command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    const reason = tracker.check(command, recipes);
    if (reason && !isTest(command)) return { block: true, reason };
    // Not awaited: pi runs the tool_call handlers of parallel calls one after another, so a wait here holds the other calls.
    const replacement = isTest(command)
      ? runTests.insteadOfBash(event.toolCallId, command, ctx)
      : isCheck(command)
        ? runTests.check(event.toolCallId, command, ctx)
        : undefined;
    if (replacement) {
      replaced.set(event.toolCallId, replacement);
      input.command = NO_OP;
      input.background = false;
      return;
    }
    const hint = tracker.started(command, recipes);
    if (hint) hints.set(event.toolCallId, hint);
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return;
    const pending = replaced.get(event.toolCallId);
    if (pending) {
      replaced.delete(event.toolCallId);
      const replacement = await pending;
      return { content: [{ type: "text", text: replacement.text }], isError: replacement.isError, terminate: replacement.background || undefined };
    }
    const hint = hints.get(event.toolCallId);
    hints.delete(event.toolCallId);
    if (!hint) return;
    return { content: [{ type: "text", text: `${textOf(event.content) ?? ""}\n${hint}` }] };
  });
}
