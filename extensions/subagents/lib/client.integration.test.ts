import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connectMain } from "./client.ts";

const timers = { setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout) };

function rid(data: string): string {
  const match = /"requestId":"([^"]+)"/.exec(data);
  if (match === null) throw new Error(`no requestId in ${data}`);
  return match[1] as string;
}

async function withServer(onData: (data: string, write: (text: string) => void) => void, run: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "cli-"));
  const path = join(root, "s.sock");
  const server: Server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => onData(data, (text) => socket.write(text)));
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    await run(path);
  } finally {
    server.close();
    await rm(root, { recursive: true });
  }
}

test("client sends hello, then status, and returns the reply", async () => {
  const received: string[] = [];
  await withServer(
    (data, write) => {
      received.push(data);
      if (data.includes('"status"')) write(`{"type":"status","requestId":"${rid(data)}","agents":[],"main":"connected"}\n`);
    },
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      assert.deepEqual(await client.status(), { agents: [], main: "connected" });
      client.close();
      assert.match(received.join(""), /"hello"/);
    },
  );
});

test("client fails with a clear error when the status times out", async () => {
  await withServer(
    () => {},
    async (path) => {
      const client = await connectMain(path, timers, 100);
      await assert.rejects(client.status(), /no status within 100 ms/);
      client.close();
    },
  );
});

test("client rejects an error reply and a missing socket", async () => {
  await withServer(
    (data, write) => write(`{"type":"error","requestId":"${rid(data)}","message":"bad"}\n`),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      await assert.rejects(client.status(), /refused the status request: bad/);
      client.close();
    },
  );
  await assert.rejects(connectMain("/tmp/pi-sub-nonexistent.sock", timers, 100), /connection to .* failed/);
});

const MODELS = ["m/x:off"];
const SOURCE = { repo: "/r", sha: "a".repeat(40) };
const result = '{"type":"result","id":"a1","status":"idle","text":"done","usage":{"tokens":2,"cost":0.1},"events":["e"],"model":"m/x:off"}';

test("client start sends the task and waits for the result of its agent, even in one chunk", async () => {
  const received: string[] = [];
  await withServer(
    (data, write) => {
      received.push(data);
      if (data.includes('"start"'))
        write(
          `{"type":"started","requestId":"${rid(data)}","id":"a1"}\n{"type":"result","id":"zz","status":"idle","text":"other","usage":{"tokens":0,"cost":0},"events":[],"model":"m/x:off"}\n${result}\n`,
        );
    },
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      assert.deepEqual(await client.start("do it", ["--no-tools"], [], MODELS, SOURCE), {
        type: "result",
        id: "a1",
        status: "idle",
        text: "done",
        usage: { tokens: 2, cost: 0.1 },
        events: ["e"],
        model: "m/x:off",
      });
      client.close();
      assert.match(received.join(""), /"task":"do it"/);
    },
  );
});

test("client start rejects an error reply, a closed connection and a missing started", async () => {
  await withServer(
    (data, write) => write(`{"type":"error","requestId":"${rid(data)}","message":"no tmux"}\n`),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      await assert.rejects(client.start("t", ["--no-tools"], [], MODELS, SOURCE), /refused the start request: no tmux/);
      client.close();
    },
  );
  await withServer(
    () => {},
    async (path) => {
      const client = await connectMain(path, timers, 100);
      await assert.rejects(client.start("t", ["--no-tools"], [], MODELS, SOURCE), /did not start the subagent within 100 ms/);
      client.close();
    },
  );
  await withServer(
    (data, write) => write(`{"type":"started","requestId":"${rid(data)}","id":"a1"}\n`),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      const waiting = client.start("t", ["--no-tools"], [], MODELS, SOURCE);
      setTimeout(() => client.close(), 50);
      await assert.rejects(waiting, /closed the connection/);
    },
  );
});

test("client start gives the id to onStarted before the result", async () => {
  await withServer(
    (data, write) => write(`{"type":"started","requestId":"${rid(data)}","id":"a1"}\n`),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      let waiting: Promise<unknown> = Promise.resolve();
      const id = await new Promise<string>((resolve) => {
        waiting = client.start("t", ["--no-tools"], [], MODELS, SOURCE, resolve);
      });
      assert.equal(id, "a1");
      client.close();
      await assert.rejects(waiting, /closed the connection/);
    },
  );
});

test("client discard returns the text and rejects an error", async () => {
  await withServer(
    (data, write) =>
      write(
        data.includes('"id":"bad"')
          ? `{"type":"error","requestId":"${rid(data)}","message":"runs"}\n`
          : `{"type":"discarded","requestId":"${rid(data)}","id":"a1","text":"removed"}\n`,
      ),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      assert.equal(await client.discard("a1"), "removed");
      await assert.rejects(client.discard("bad"), /refused the discard request: runs/);
      client.close();
    },
  );
});

test("client matches answers by requestId, in any order", async () => {
  const ids: { status: string[]; start: string[] } = { status: [], start: [] };
  const flush = (write: (text: string) => void) => {
    if (ids.status.length < 2 || ids.start.length < 1) return;
    write(`{"type":"status","requestId":"${ids.status[1]}","agents":[],"main":"gone"}\n`);
    write(`{"type":"started","requestId":"${ids.start[0]}","id":"a1"}\n${result}\n`);
    write(`{"type":"status","requestId":"${ids.status[0]}","agents":[],"main":"connected"}\n`);
  };
  await withServer(
    (data, write) => {
      for (const line of data.split("\n")) {
        if (line.includes('"type":"status"')) ids.status.push(rid(line));
        if (line.includes('"type":"start"')) ids.start.push(rid(line));
      }
      flush(write);
    },
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      const first = client.status();
      const started = client.start("t", [], [], MODELS, SOURCE);
      const second = client.status();
      assert.deepEqual(await first, { agents: [], main: "connected" });
      assert.deepEqual(await second, { agents: [], main: "gone" });
      assert.equal((await started).id, "a1");
      client.close();
    },
  );
});

test("client rejects only the request that an error names", async () => {
  await withServer(
    (data, write) => {
      if (data.includes('"type":"start"')) write(`{"type":"error","requestId":"${rid(data.slice(data.indexOf('"type":"start"')))}","message":"no tmux"}\n`);
      if (data.includes('"type":"status"'))
        setTimeout(() => write(`{"type":"status","requestId":"${rid(data.slice(data.indexOf('"type":"status"')))}","agents":[],"main":"gone"}\n`), 50);
    },
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      const waiting = client.status();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await assert.rejects(client.start("t", [], [], MODELS, SOURCE), /refused the start request: no tmux/);
      assert.deepEqual(await waiting, { agents: [], main: "gone" });
      client.close();
    },
  );
});

test("client fails loud on an unknown requestId, a missing one, and an error without one", async () => {
  for (const reply of [
    '{"type":"status","requestId":"99","agents":[],"main":"gone"}',
    '{"type":"status","agents":[],"main":"gone"}',
    '{"type":"error","message":"x"}',
  ]) {
    await withServer(
      (_data, write) => write(`${reply}\n`),
      async (path) => {
        const client = await connectMain(path, timers, 1000);
        const waiting = client.discard("a1");
        await assert.rejects(waiting, /discard request failed: .*(status|error|refused)/);
        client.close();
      },
    );
  }
});

test("client rejects every waiting request when the connection closes", async () => {
  await withServer(
    () => {},
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      const waiting = [client.status(), client.discard("a1"), client.start("t", [], [], MODELS, SOURCE)];
      setTimeout(() => client.close(), 50);
      const settled = await Promise.allSettled(waiting);
      const reasons = settled.map((entry) => (entry.status === "rejected" ? (entry.reason as Error).message : "resolved"));
      assert.match(reasons[0] as string, /status request failed: .*closed the connection/);
      assert.match(reasons[1] as string, /discard request failed: .*closed the connection/);
      assert.match(reasons[2] as string, /start request failed: .*closed the connection/);
    },
  );
});
