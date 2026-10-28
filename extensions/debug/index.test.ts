import assert from "node:assert/strict";
import { test } from "node:test";
import { expression, payloadOf } from "./lib/lua.ts";
import { Debugger, dapConfig, formatStatus } from "./lib/session.ts";

type Reply = { code?: number; stdout?: string; stderr?: string };

function setup(handler: (payload: Record<string, unknown> | null, command: string, args: string[]) => Reply) {
  const calls: { command: string; args: string[]; payload: Record<string, unknown> | null }[] = [];
  let time = 0;
  const dbg = new Debugger({
    run: async (command, args) => {
      const expr = args.at(-1) ?? "";
      const payload = expr.startsWith("luaeval(") ? (payloadOf(expr) as Record<string, unknown>) : null;
      calls.push({ command, args, payload });
      const r = handler(payload, command, args);
      return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    sleep: async (ms) => {
      time += ms;
    },
    now: () => time,
    nvim: "nvim",
    server: "/s.sock",
  });
  return { dbg, calls };
}
const json = (v: unknown): Reply => ({ stdout: JSON.stringify(v) });

test("expression round-trips the payload and has no raw newline", () => {
  const p = { op: "start", expression: "a\"b\\c\n'" };
  const e = expression(p);
  assert.deepEqual(payloadOf(e), p);
  assert.ok(!e.includes("\n"));
});

test("dapConfig derives the adapter from the extension", () => {
  assert.equal(dapConfig({ file: "/p/a.test.ts" }, "/p").type, "pwa-node");
  assert.deepEqual((dapConfig({ file: "/p/a.test.ts" }, "/p") as { runtimeArgs: string[] }).runtimeArgs, ["--experimental-strip-types"]);
  assert.equal(dapConfig({ file: "/p/a.py" }, "/p").type, "python");
  const go = dapConfig({ file: "/p/x/a_test.go" }, "/p");
  assert.deepEqual([go.type, go.mode, go.program], ["delve", "test", "/p/x"]);
  assert.equal(dapConfig({ file: "/p/a.js", adapter: "custom" }, "/p").type, "custom");
  assert.equal(dapConfig({ file: "/p/a.js" }, "/p").cwd, "/p");
});

test("start sets breakpoints and waits until stopped, with details", async () => {
  let polls = 0;
  const { dbg, calls } = setup((p) => {
    if (!p) return { stdout: "1" };
    if (p.op === "start") return json({ ok: true });
    polls++;
    if (polls < 3) return json({ status: "running", output: "hello\n" });
    return json({
      status: "stopped",
      reason: "breakpoint",
      details: true,
      frames: [{ name: "f", file: "/p/a.js", line: 3 }],
      source: "  const x = 1;",
      locals: [{ name: "Local", variables: [{ name: "x", value: "y".repeat(500) }] }],
    });
  });
  const text = await dbg.start({ file: "/p/a.js", breakpoints: [{ file: "/p/a.js", line: 3, condition: "x" }] }, "/p");
  const start = calls.find((c) => c.payload?.op === "start")?.payload as { breakpoints: unknown[]; config: { type: string } };
  assert.deepEqual(start.breakpoints, [{ file: "/p/a.js", line: 3, condition: "x" }]);
  assert.equal(start.config.type, "pwa-node");
  assert.match(text, /stopped: breakpoint at \/p\/a\.js:3/);
  assert.match(text, /> const x = 1;/);
  assert.match(text, /hello/);
  assert.ok(!text.includes("y".repeat(201)));
});

test("terminated reports exit code and output tail", async () => {
  const { dbg } = setup((p) => (!p ? { stdout: "1" } : p.op === "start" ? json({ ok: true }) : json({ status: "terminated", exit_code: 2, output: "bye" })));
  const text = await dbg.start({ file: "/p/a.js" }, "/p");
  assert.match(text, /terminated, exit code 2/);
  assert.match(text, /bye/);
});

test("start times out after 30 s of running", async () => {
  const { dbg } = setup((p) => (!p ? { stdout: "1" } : p.op === "start" ? json({ ok: true }) : json({ status: "running" })));
  assert.match(await dbg.start({ file: "/p/a.js" }, "/p"), /still running after 30 s/);
});

test("a foreign dap session is an error", async () => {
  const { dbg } = setup((p) => (!p ? { stdout: "1" } : p.op === "start" ? json({ ok: true }) : json({ status: "foreign" })));
  await assert.rejects(dbg.start({ file: "/p/a.js" }, "/p"), /own dap session/);
});

test("a Lua error becomes an exception", async () => {
  const { dbg } = setup((p) => (!p ? { stdout: "1" } : json({ error: "no debug session is running" })));
  await assert.rejects(dbg.step("continue"), /no debug session is running/);
});

test("eval polls for the result", async () => {
  let n = 0;
  const { dbg } = setup((p) => {
    if (!p) return { stdout: "1" };
    if (p.op === "eval") return json({ pending: true });
    return n++ < 1 ? json({}) : json({ eval: { ok: true, value: "42" } });
  });
  assert.equal(await dbg.evaluate("6*7"), "42");
});

test("an unanswering socket starts nvim@main once, then fails loudly", async () => {
  const { dbg, calls } = setup(() => ({ code: 1, stderr: "no" }));
  await assert.rejects(dbg.start({ file: "/p/a.js" }, "/p"), /\/s\.sock.*journalctl --user -u nvim@main/);
  assert.equal(calls.filter((c) => c.command === "systemctl").length, 1);
  assert.deepEqual(calls.find((c) => c.command === "systemctl")?.args, ["--user", "start", "nvim@main.service"]);
});

test("a socket that answers after systemctl start works", async () => {
  let up = false;
  const { dbg } = setup((p, command) => {
    if (command === "systemctl") {
      up = true;
      return {};
    }
    if (!up) return { code: 1 };
    return p ? json({ ok: true }) : { stdout: "1" };
  });
  await dbg.connect();
});

test("stop terminates, waits and wipes; shutdown is silent without a session", async () => {
  const { dbg, calls } = setup((p) => {
    if (!p) return { stdout: "1" };
    if (p.op === "stop") return json({ stopping: true });
    if (p.op === "status") return json({ status: "terminated" });
    return json({ kept: [] });
  });
  await dbg.shutdown();
  assert.equal(calls.length, 0);
  assert.match(await dbg.stop(), /stopped; breakpoints cleared/);
  assert.deepEqual(
    calls.filter((c) => c.payload).map((c) => c.payload?.op),
    ["stop", "status", "wipe"],
  );
});

test("formatStatus keeps 10 frames", () => {
  const frames = Array.from({ length: 15 }, (_, i) => ({ name: `f${i}`, file: "/a", line: i }));
  assert.equal(
    formatStatus({ status: "stopped", frames })
      .split("\n")
      .filter((l) => l.startsWith("  f")).length,
    10,
  );
});
