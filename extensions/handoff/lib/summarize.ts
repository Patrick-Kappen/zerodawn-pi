import { CARD_PARAMETERS, type Card, checkCard } from "./card.ts";

export const TRANSCRIPT_MAX_CHARS = 120_000;
const CALL_TIMEOUT_MS = 120_000;
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const SYSTEM = [
  "You keep the handoff card of a coding session up to date. The next agent reads only this card.",
  "Call write_card once with the full new card. Keep only what the next actions need. Drop finished history, chat and tool output.",
  "Use the facts for the current state. Mark each PR as merged or open; do not guess a status that the transcript does not show.",
  "Write short lines in plain English. Use only the facts, the transcript and the previous card.",
].join("\n");

export type Message = { stopReason: string; errorMessage?: string; content: { type: string; name?: string; arguments?: unknown }[] };
export type Registry = {
  find(provider: string, id: string): unknown;
  hasConfiguredAuth(model: unknown): boolean;
  complete(model: unknown, context: unknown, options: unknown): Promise<Message>;
};

export function parseEntry(entry: string): { provider: string; id: string; thinking?: string } {
  const slash = entry.indexOf("/");
  if (slash <= 0 || slash === entry.length - 1)
    throw new Error(`handoff: model entry "${entry}" is not "provider/id[:thinking]". Fix "handoffModels" in config.json.`);
  const rest = entry.slice(slash + 1);
  const colon = rest.lastIndexOf(":");
  const thinking = colon > 0 ? rest.slice(colon + 1) : undefined;
  if (thinking !== undefined && LEVELS.includes(thinking)) return { provider: entry.slice(0, slash), id: rest.slice(0, colon), thinking };
  return { provider: entry.slice(0, slash), id: rest };
}

export function prompt(previous: Card | undefined, facts: string[], transcript: string[]): string {
  const text = transcript.join("\n");
  const cut = text.length > TRANSCRIPT_MAX_CHARS ? `[earlier lines left out]\n${text.slice(-TRANSCRIPT_MAX_CHARS)}` : text;
  return [
    `Facts now:\n${facts.join("\n") || "(none)"}`,
    `Previous card:\n${previous ? JSON.stringify(previous) : "(none)"}`,
    `Transcript since the previous card:\n${cut || "(nothing new)"}`,
  ].join("\n\n");
}

export async function writeCard(
  registry: Registry,
  ladder: string[],
  previous: Card | undefined,
  facts: string[],
  transcript: string[],
  signal?: AbortSignal,
): Promise<{ card: Card; model: string }> {
  const failed: string[] = [];
  const context = {
    systemPrompt: SYSTEM,
    messages: [{ role: "user", content: prompt(previous, facts, transcript), timestamp: Date.now() }],
    tools: [{ name: "write_card", description: "Write the full handoff card.", parameters: CARD_PARAMETERS }],
  };
  for (const entry of ladder) {
    const { provider, id, thinking } = parseEntry(entry);
    const model = registry.find(provider, id);
    if (!model) {
      failed.push(`${entry}: not in the pi model registry`);
      continue;
    }
    if (!registry.hasConfiguredAuth(model)) {
      failed.push(`${entry}: no auth`);
      continue;
    }
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    let message: Message;
    try {
      message = await registry.complete(model, context, {
        maxTokens: 4000,
        reasoning: thinking === "off" ? undefined : thinking,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      failed.push(`${entry}: ${(err as Error).message}`);
      continue;
    }
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      failed.push(`${entry}: ${message.errorMessage ?? message.stopReason}`);
      continue;
    }
    const call = message.content.find((c) => c.type === "toolCall" && c.name === "write_card");
    if (!call) {
      failed.push(`${entry}: no write_card call`);
      continue;
    }
    try {
      return { card: checkCard(call.arguments), model: entry };
    } catch (err) {
      failed.push(`${entry}: ${(err as Error).message}`);
    }
  }
  throw new Error(`handoff: no model wrote a valid card. ${failed.join("; ")}. Check "handoffModels" in config.json and the auth of these models.`);
}
