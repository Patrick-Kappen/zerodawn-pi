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
