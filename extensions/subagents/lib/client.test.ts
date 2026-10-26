import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connectMain } from "./client.ts";

const timers = { setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout) };

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
      if (data.includes('"status"')) write('{"type":"status","agents":[],"main":"connected"}\n');
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
    (_data, write) => write('{"type":"error","message":"bad"}\n'),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      await assert.rejects(client.status(), /refused the request: bad/);
      client.close();
    },
  );
  await assert.rejects(connectMain("/tmp/pi-sub-nonexistent.sock", timers, 100), /connection to .* failed/);
});

const SOURCE = { repo: "/r", sha: "a".repeat(40) };
const result = '{"type":"result","id":"a1","status":"idle","text":"done","usage":{"tokens":2,"cost":0.1},"events":["e"]}';

test("client start sends the task and waits for the result of its agent, even in one chunk", async () => {
  const received: string[] = [];
  await withServer(
    (data, write) => {
      received.push(data);
      if (data.includes('"start"'))
        write(
          `{"type":"started","id":"a1"}\n{"type":"result","id":"zz","status":"idle","text":"other","usage":{"tokens":0,"cost":0},"events":[]}\n${result}\n`,
        );
    },
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      assert.deepEqual(await client.start("do it", ["--no-tools"], [], SOURCE), {
        type: "result",
        id: "a1",
        status: "idle",
        text: "done",
        usage: { tokens: 2, cost: 0.1 },
        events: ["e"],
      });
      client.close();
      assert.match(received.join(""), /"task":"do it"/);
    },
  );
});

test("client start rejects an error reply, a closed connection and a missing started", async () => {
  await withServer(
    (_data, write) => write('{"type":"error","message":"no tmux"}\n'),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      await assert.rejects(client.start("t", ["--no-tools"], [], SOURCE), /refused the request: no tmux/);
      client.close();
    },
  );
  await withServer(
    () => {},
    async (path) => {
      const client = await connectMain(path, timers, 100);
      await assert.rejects(client.start("t", ["--no-tools"], [], SOURCE), /did not start the subagent within 100 ms/);
      client.close();
    },
  );
  await withServer(
    (_data, write) => write('{"type":"started","id":"a1"}\n'),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      const waiting = client.start("t", ["--no-tools"], [], SOURCE);
      setTimeout(() => client.close(), 50);
      await assert.rejects(waiting, /closed the connection/);
    },
  );
});

test("client start stops waiting on abort", async () => {
  await withServer(
    (_data, write) => write('{"type":"started","id":"a1"}\n'),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      const controller = new AbortController();
      const waiting = client.start("t", ["--no-tools"], [], SOURCE, controller.signal);
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(waiting, /subagent a1 was aborted/);
      client.close();
    },
  );
});

test("client discard returns the text and rejects an error", async () => {
  await withServer(
    (data, write) => write(data.includes('"id":"bad"') ? '{"type":"error","message":"runs"}\n' : '{"type":"discarded","id":"a1","text":"removed"}\n'),
    async (path) => {
      const client = await connectMain(path, timers, 1000);
      assert.equal(await client.discard("a1"), "removed");
      await assert.rejects(client.discard("bad"), /refused the request: runs/);
      client.close();
    },
  );
});
