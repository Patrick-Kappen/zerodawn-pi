import { readFileSync } from "node:fs";
import { parseEntry, type Registry } from "./summarize.ts";
import type { Entry } from "./transcript.ts";

export const RECALL_MAX_CHARS = 200_000;
export const RECALL_TEXT_MAX = 2_000;
const CHUNK_LINES = 40;
const CALL_TIMEOUT_MS = 120_000;

const SYSTEM = [
  "You answer one question about an earlier coding session from its stripped transcript.",
  "Each line starts with an entry id in brackets. Answer in at most 8 short lines, and give the entry ids that support each point.",
  'When the transcript does not hold the answer, say "Not in the transcript." and nothing else.',
].join("\n");

export function readSession(path: string): Entry[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`recall: cannot read the session file ${path}: ${(err as Error).message}. Give the path of a .jsonl session file.`, { cause: err });
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line) as Entry;
      } catch (err) {
        throw new Error(`recall: line ${i + 1} of ${path} is not JSON: ${(err as Error).message}.`, { cause: err });
      }
    })
    .filter((e) => e.type === "message" || e.type === "custom_message");
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}_./-]{3,}/gu) ?? []);

export function select(lines: string[], question: string, maxChars: number): string[] {
  if (lines.reduce((n, l) => n + l.length + 1, 0) <= maxChars) return lines;
  const asked = words(question);
  const chunks: { at: number; lines: string[]; score: number }[] = [];
  for (let at = 0; at < lines.length; at += CHUNK_LINES) {
    const part = lines.slice(at, at + CHUNK_LINES);
    const found = words(part.join(" "));
    chunks.push({ at, lines: part, score: [...asked].filter((w) => found.has(w)).length });
  }
  const chosen: typeof chunks = [];
  let size = 0;
  for (const c of [...chunks].sort((a, b) => b.score - a.score || b.at - a.at)) {
    const n = c.lines.reduce((s, l) => s + l.length + 1, 0);
    if (size + n > maxChars) continue;
    chosen.push(c);
    size += n;
  }
  return chosen.sort((a, b) => a.at - b.at).flatMap((c, i, all) => (i > 0 && all[i - 1].at + CHUNK_LINES < c.at ? ["[…]", ...c.lines] : c.lines));
}

export async function ask(
  registry: Registry,
  ladder: string[],
  question: string,
  lines: string[],
  signal?: AbortSignal,
): Promise<{ answer: string; model: string }> {
  const failed: string[] = [];
  const context = {
    systemPrompt: SYSTEM,
    messages: [{ role: "user", content: `Question: ${question}\n\nTranscript:\n${lines.join("\n")}`, timestamp: Date.now() }],
  };
  for (const entry of ladder) {
    const { provider, id, thinking } = parseEntry(entry);
    const model = registry.find(provider, id);
    if (!model || !registry.hasConfiguredAuth(model)) {
      failed.push(`${entry}: ${model ? "no auth" : "not in the pi model registry"}`);
      continue;
    }
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    try {
      const message = await registry.complete(model, context, {
        maxTokens: 1500,
        reasoning: thinking === "off" ? undefined : thinking,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const answer = message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text?: string }).text ?? "")
        .join("")
        .trim();
      if (message.stopReason === "error" || message.stopReason === "aborted") failed.push(`${entry}: ${message.errorMessage ?? message.stopReason}`);
      else if (!answer) failed.push(`${entry}: empty answer`);
      else return { answer, model: entry };
    } catch (err) {
      failed.push(`${entry}: ${(err as Error).message}`);
    }
  }
  throw new Error(`recall: no model answered. ${failed.join("; ")}. Check "handoffModels" in config.json and the auth of these models.`);
}
