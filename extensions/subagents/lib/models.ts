export const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const CACHE_MS = 5 * 60_000;
export const PROBE_TIMEOUT_MS = 20_000;
const CONFIG_HINT = 'Fix "subagentModels" in config.json (programs.zerodawn-pi.subagentModels).';

export interface Entry {
  entry: string;
  provider: string;
  id: string;
  thinking?: string;
}

export interface ModelLike {
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<string, string | null>>;
}

export interface Registry<M extends ModelLike> {
  find(provider: string, id: string): M | undefined;
  hasConfiguredAuth(model: M): boolean;
  complete(
    model: M,
    context: { messages: { role: "user"; content: string; timestamp: number }[] },
    options: { signal: AbortSignal; maxTokens: number },
  ): Promise<{ stopReason: string; errorMessage?: string }>;
}

export function parseEntry(entry: string): Entry {
  const slash = entry.indexOf("/");
  if (slash <= 0 || slash === entry.length - 1) {
    throw new Error(`subagents: model entry "${entry}" is not "provider/id[:thinking]". ${CONFIG_HINT}`);
  }
  const provider = entry.slice(0, slash);
  const rest = entry.slice(slash + 1);
  const colon = rest.lastIndexOf(":");
  if (colon > 0 && LEVELS.includes(rest.slice(colon + 1))) return { entry, provider, id: rest.slice(0, colon), thinking: rest.slice(colon + 1) };
  return { entry, provider, id: rest };
}

export function checkEntry<M extends ModelLike>(registry: Pick<Registry<M>, "find">, entry: string): M {
  const parsed = parseEntry(entry);
  const model = registry.find(parsed.provider, parsed.id);
  if (model === undefined) {
    throw new Error(
      `subagents: model entry "${entry}" is not in the pi model registry. Check the provider and id, or add the model to models.json. ${CONFIG_HINT}`,
    );
  }
  const level = parsed.thinking;
  if (level === undefined) return model;
  const supported = model.reasoning ? model.thinkingLevelMap?.[level] !== null : level === "off";
  if (!supported) {
    throw new Error(`subagents: model entry "${entry}" has the thinking level "${level}", which the model does not support. ${CONFIG_HINT}`);
  }
  return model;
}

export function checkLadder<M extends ModelLike>(registry: Pick<Registry<M>, "find">, entries: string[]): Map<string, M> {
  return new Map(entries.map((entry) => [entry, checkEntry(registry, entry)]));
}

export async function probeModel<M extends ModelLike>(registry: Registry<M>, model: M): Promise<void> {
  if (!registry.hasConfiguredAuth(model)) throw new Error("no auth is configured");
  const message = await registry.complete(
    model,
    { messages: [{ role: "user", content: "Reply with: ok", timestamp: Date.now() }] },
    { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), maxTokens: 16 },
  );
  if (message.stopReason === "aborted") throw new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000} s`);
  if (message.stopReason === "error") throw new Error(message.errorMessage ?? "the provider returned an error");
}

export interface Unavailable {
  entry: string;
  reason: string;
}

export function failedText(failed: Unavailable[]): string {
  return failed.map((item) => `${item.entry}: ${item.reason}`).join("; ");
}

// One result per entry for CACHE_MS; the promise is cached, so parallel starts share one probe.
export function createAvailability(now: () => number) {
  const cache = new Map<string, { until: number; result: Promise<string | undefined> }>();

  function check(entry: string, probe: (entry: string) => Promise<void>): Promise<string | undefined> {
    const cached = cache.get(entry);
    if (cached !== undefined && cached.until > now()) return cached.result;
    const result = probe(entry).then(
      () => undefined,
      (error: Error) => error.message,
    );
    cache.set(entry, { until: now() + CACHE_MS, result });
    return result;
  }

  async function pick(entries: string[], probe: (entry: string) => Promise<void>): Promise<{ entry: string; failed: Unavailable[] }> {
    const failed: Unavailable[] = [];
    for (const entry of entries) {
      const reason = await check(entry, probe);
      if (reason === undefined) return { entry, failed };
      failed.push({ entry, reason });
    }
    throw new Error(
      `subagents: no model of "subagentModels" is available. ${failedText(failed)}. Fix the provider, or change "subagentModels" in config.json.`,
    );
  }

  function mark(entry: string, reason: string): void {
    cache.set(entry, { until: now() + CACHE_MS, result: Promise.resolve(reason) });
  }

  return { pick, mark };
}

// The supervisor cannot probe: it only remembers the entries that ended an agent with a provider error.
export function createMarks(now: () => number) {
  const until = new Map<string, number>();
  return {
    mark: (entry: string) => void until.set(entry, now() + CACHE_MS),
    marked: (entry: string) => (until.get(entry) ?? 0) > now(),
  };
}
