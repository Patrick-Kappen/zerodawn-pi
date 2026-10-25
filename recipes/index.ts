import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { textOf } from "../shared/util.ts";
import { loadRecipes, promptText, type Recipes, Tracker } from "./recipes.ts";

export default function (pi: ExtensionAPI) {
  let tracker = new Tracker();
  let recipes: Recipes | undefined;
  const hints = new Map<string, string>();

  pi.on("session_start", () => {
    tracker = new Tracker();
  });

  pi.on("before_agent_start", (event, ctx) => {
    tracker.turn();
    recipes = loadRecipes(ctx.cwd);
    if (recipes) event.systemPromptOptions.sections.project_recipes = promptText(recipes);
  });

  pi.on("tool_call", (event) => {
    const command = (event.input as any).command;
    if (event.toolName !== "bash" || typeof command !== "string") return;
    const reason = tracker.check(command, recipes);
    if (reason) return { block: true, reason };
    const hint = tracker.started(command, recipes);
    if (hint) hints.set(event.toolCallId, hint);
  });

  pi.on("tool_result", (event) => {
    if ((event.toolName === "edit" || event.toolName === "write") && !event.isError) tracker.changed();
    if (event.toolName !== "bash") return;
    const text = textOf(event.content) ?? "";
    const command = (event.input as any)?.command;
    if (typeof command === "string") tracker.ended(command, text);
    const hint = hints.get(event.toolCallId);
    hints.delete(event.toolCallId);
    return hint ? { content: [{ type: "text", text: `${text}\n${hint}` }] } : undefined;
  });
}
