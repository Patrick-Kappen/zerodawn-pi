import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./fake-pi.ts", import.meta.url));

test("the fake pi says hello and answers a task with a settle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fake-pi-"));
  const path = join(dir, "s.sock");
  const lines: Record<string, unknown>[] = [];
  let client: Socket | undefined;
  const settled = new Promise<void>((resolve, reject) => {
    const server = createServer((socket) => {
      client = socket;
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
          const message = JSON.parse(buffer.slice(0, i));
          buffer = buffer.slice(i + 1);
          lines.push(message);
          if (message.type === "hello") socket.write(`${JSON.stringify({ type: "task", task: "x" })}\n`);
          if (message.type === "handoff") {
            socket.end();
            server.close();
            resolve();
          }
        }
      });
    });
    server.on("error", reject);
    server.listen(path);
  });
  const child = spawn(process.execPath, [script], { env: { ...process.env, PI_SUBAGENT_SOCKET: path, PI_SUBAGENT_ID: "id-1" }, stdio: "ignore" });
  const exited = new Promise((resolve) => child.on("exit", resolve));
  try {
    await settled;
    await exited;
  } finally {
    client?.destroy();
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
  assert.deepEqual(lines[0], { type: "hello", role: "sub", id: "id-1" });
  assert.deepEqual(lines.at(-1), {
    type: "handoff",
    data: { summary: "answer to: x", change: "fix", changes: [], tests: [], findings: ["a.ts:1 fact"], decisions: [], open: [], next: "", risks: [] },
    gate: { ok: true, files: [], tests: "not run: no changed files" },
  });
});
