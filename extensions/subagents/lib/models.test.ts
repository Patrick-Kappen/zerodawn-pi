import assert from "node:assert/strict";
import { test } from "node:test";
import { CACHE_MS, checkEntry, checkLadder, createAvailability, createMarks, type ModelLike, parseEntry, probeModel, type Registry } from "./models.ts";

test("parseEntry splits provider, id and thinking level; a colon in the id stays in the id", () => {
  assert.deepEqual(parseEntry("a/b:low"), { entry: "a/b:low", provider: "a", id: "b", thinking: "low" });
  assert.deepEqual(parseEntry("a/b"), { entry: "a/b", provider: "a", id: "b" });
  assert.deepEqual(parseEntry("a/qwen:8b"), { entry: "a/qwen:8b", provider: "a", id: "qwen:8b" });
  assert.deepEqual(parseEntry("a/b/c:high"), { entry: "a/b/c:high", provider: "a", id: "b/c", thinking: "high" });
  for (const bad of ["", "a", "/b", "a/"]) assert.throws(() => parseEntry(bad), /not "provider\/id\[:thinking\]".*subagentModels/);
});

const models: Record<string, ModelLike> = {
  "p/plain": { reasoning: false },
  "p/open": { reasoning: true },
  "p/mapped": { reasoning: true, thinkingLevelMap: { off: null, low: "L", high: null } },
};
const registry = { find: (provider: string, id: string) => models[`${provider}/${id}`] };

test("checkEntry: unknown model, unsupported thinking level", () => {
  assert.equal(checkEntry(registry, "p/plain"), models["p/plain"]);
  assert.equal(checkEntry(registry, "p/plain:off"), models["p/plain"]);
  assert.equal(checkEntry(registry, "p/open:max"), models["p/open"]);
  assert.equal(checkEntry(registry, "p/mapped:low"), models["p/mapped"]);
  assert.equal(checkEntry(registry, "p/mapped:medium"), models["p/mapped"]);
  assert.throws(() => checkEntry(registry, "p/ghost:low"), /"p\/ghost:low" is not in the pi model registry/);
  assert.throws(() => checkEntry(registry, "p/plain:low"), /"p\/plain:low" has the thinking level "low"/);
  assert.throws(() => checkEntry(registry, "p/mapped:high"), /"p\/mapped:high" has the thinking level "high"/);
  assert.throws(() => checkEntry(registry, "p/mapped:off"), /thinking level "off"/);
});

test("checkLadder names the first bad entry", () => {
  assert.deepEqual([...checkLadder(registry, ["p/open:low", "p/plain"]).keys()], ["p/open:low", "p/plain"]);
  assert.throws(() => checkLadder(registry, ["p/open:low", "p/nope"]), /"p\/nope"/);
});

function fakeRegistry(complete: Registry<ModelLike>["complete"], auth = true): Registry<ModelLike> {
  return { find: registry.find, hasConfiguredAuth: () => auth, complete };
}

test("probeModel: auth, error answer, timeout and success", async () => {
  const model = models["p/open"] as ModelLike;
  await assert.rejects(
    probeModel(
      fakeRegistry(async () => ({ stopReason: "stop" }), false),
      model,
    ),
    /no auth is configured/,
  );
  await assert.rejects(
    probeModel(
      fakeRegistry(async () => ({ stopReason: "error", errorMessage: "429 quota" })),
      model,
    ),
    /429 quota/,
  );
  await assert.rejects(
    probeModel(
      fakeRegistry(async () => ({ stopReason: "error" })),
      model,
    ),
    /provider returned an error/,
  );
  await assert.rejects(
    probeModel(
      fakeRegistry(async () => ({ stopReason: "aborted" })),
      model,
    ),
    /no answer within 20 s/,
  );
  await assert.rejects(
    probeModel(
      fakeRegistry(async () => {
        throw new Error("connection refused");
      }),
      model,
    ),
    /connection refused/,
  );
  let options: { maxTokens: number; signal: AbortSignal } | undefined;
  await probeModel(
    fakeRegistry(async (_model, _context, given) => {
      options = given;
      return { stopReason: "stop" };
    }),
    model,
  );
  assert.equal(options?.maxTokens, 16);
  assert.equal(options?.signal.aborted, false);
});

test("pick takes the first available entry, lists the failed ones, and caches each result for 5 minutes", async () => {
  let time = 0;
  const availability = createAvailability(() => time);
  const probed: string[] = [];
  const probe = async (entry: string) => {
    probed.push(entry);
    if (entry !== "c/3") throw new Error(`${entry} down`);
  };
  const entries = ["a/1", "b/2", "c/3", "d/4"];
  assert.deepEqual(await availability.pick(entries, probe), {
    entry: "c/3",
    failed: [
      { entry: "a/1", reason: "a/1 down" },
      { entry: "b/2", reason: "b/2 down" },
    ],
  });
  assert.deepEqual(probed, ["a/1", "b/2", "c/3"]);
  time = CACHE_MS - 1;
  await availability.pick(entries, probe);
  assert.equal(probed.length, 3);
  time = CACHE_MS;
  await availability.pick(entries, probe);
  assert.deepEqual(probed.slice(3), ["a/1", "b/2", "c/3"]);
});

test("parallel picks share one probe", async () => {
  const availability = createAvailability(() => 0);
  let calls = 0;
  const probe = async () => {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
  };
  await Promise.all([availability.pick(["a/1"], probe), availability.pick(["a/1"], probe), availability.pick(["a/1"], probe)]);
  assert.equal(calls, 1);
});

test("pick with no available entry names each entry and its reason; mark makes an entry unavailable", async () => {
  const availability = createAvailability(() => 0);
  await assert.rejects(
    availability.pick(["a/1", "b/2"], async (entry) => {
      throw new Error(entry === "a/1" ? "no auth is configured" : "503");
    }),
    /a\/1: no auth is configured; b\/2: 503\./,
  );
  const ok = async () => {};
  const fresh = createAvailability(() => 0);
  assert.equal((await fresh.pick(["a/1", "b/2"], ok)).entry, "a/1");
  fresh.mark("a/1", "429");
  assert.deepEqual(await fresh.pick(["a/1", "b/2"], ok), { entry: "b/2", failed: [{ entry: "a/1", reason: "429" }] });
});

test("createMarks: a mark ends after 5 minutes", () => {
  let time = 0;
  const marks = createMarks(() => time);
  assert.equal(marks.marked("a/1"), false);
  marks.mark("a/1");
  time = CACHE_MS - 1;
  assert.equal(marks.marked("a/1"), true);
  time = CACHE_MS;
  assert.equal(marks.marked("a/1"), false);
});
