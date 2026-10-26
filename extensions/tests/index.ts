import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { textOf } from "../../shared/util.ts";
import { isTest, loadRecipes, normalize, promptText, type Recipes, Tracker } from "./lib/recipes.ts";
import { RunTests, TOOL } from "./lib/run.ts";

export default function (pi: ExtensionAPI) {
  let tracker = new Tracker();
  let recipes: Recipes | undefined;
  const hints = new Map<string, string>();

  const runTests = new RunTests();

  pi.registerTool({
    ...TOOL,
    parameters: Type.Object({
      scope: Type.Optional(StringEnum(["changed", "all"] as const, { description: "changed (default): tests for the changed files. all: every test." })),
      rerun: Type.Optional(Type.Boolean({ description: "Run again when no file changed, for a flaky test." })),
      path: Type.Optional(Type.String({ description: "Project directory, such as a git worktree. Default: the current directory." })),
    }),
    execute: (toolCallId, params, signal, _onUpdate, ctx) => runTests.execute(toolCallId, params, signal, ctx),
  });

  pi.on("session_start", () => {
    tracker = new Tracker();
    runTests.reset();
  });

  pi.on("before_agent_start", (event, ctx) => {
    recipes = loadRecipes(ctx.cwd);
    if (recipes) event.systemPromptOptions.sections.project_recipes = promptText(recipes);
  });

  pi.on("tool_call", async (event, ctx) => {
    const command = (event.input as any).command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    if (isTest(normalize(command))) return { block: true, reason: await runTests.insteadOfBash(event.toolCallId, command, ctx) };
    const reason = tracker.check(command, recipes);
    if (reason) return { block: true, reason };
    const hint = tracker.started(command, recipes);
    if (hint) hints.set(event.toolCallId, hint);
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash") return;
    const hint = hints.get(event.toolCallId);
    hints.delete(event.toolCallId);
    if (!hint) return;
    return { content: [{ type: "text", text: `${textOf(event.content) ?? ""}\n${hint}` }] };
  });
}
