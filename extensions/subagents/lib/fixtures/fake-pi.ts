// Stands in for pi in tests: connects with the env vars, answers a task with fake events and a settle.
import { createConnection } from "node:net";

const path = process.env.PI_SUBAGENT_SOCKET;
const id = process.env.PI_SUBAGENT_ID;
if (path === undefined || id === undefined) throw new Error("fake-pi: PI_SUBAGENT_SOCKET and PI_SUBAGENT_ID must be set.");
const socket = createConnection(path);
const send = (message: object) => socket.write(`${JSON.stringify(message)}\n`);
let buffer = "";
socket.setEncoding("utf8");
socket.on("connect", () => send({ type: "hello", role: "sub", id }));
socket.on("data", (chunk) => {
  buffer += chunk;
  for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
    const message = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (message.type === "handoff") {
      send({ type: "handoff", data: { done: ["a"], open: ["b"], next: "c", files: ["f.ts"], risks: [], tests: "green" } });
      continue;
    }
    if (message.type !== "task") continue;
    if (message.task === "BLOCK") {
      send({ type: "blocker", data: { issue: "no access", files: ["x.ts", "y.ts"], tried: ["a", "b"] } });
      send({ type: "event", event: { kind: "settled", text: "blocked" } });
      continue;
    }
    if (message.task === "HANDOFF") {
      send({ type: "event", event: { kind: "message", text: "big", usage: { tokens: 100000, cost: 1 } } });
      continue;
    }
    if (message.task === "CHANGES") {
      send({
        type: "done",
        data: { summary: "It works.", changes: [{ file: "a.ts", what: "w" }], tests: [{ file: "a.test.ts", covers: "c" }], decisions: ["d"], open: [] },
        gate: { ok: true, files: ["a.ts", "a.test.ts"], tests: "green: 2 pass, 0 fail" },
      });
      continue;
    }
    if (message.task === "ASK") {
      send({ type: "ask", text: "which db?" });
      send({ type: "event", event: { kind: "settled", text: "asked" } });
      continue;
    }
    send({ type: "event", event: { kind: "tool_start", name: "bash", args: "x".repeat(200) } });
    send({ type: "event", event: { kind: "tool_end", name: "bash", isError: false } });
    send({ type: "event", event: { kind: "message", text: "working", usage: { tokens: 7, cost: 0.01 } } });
    send({
      type: "done",
      data: { summary: `answer to: ${message.task}`, findings: ["a.ts:1 fact"] },
      gate: { ok: true, files: [], tests: "not run: no changed files" },
    });
  }
});
socket.on("close", () => process.exit(0));
setInterval(() => {}, 1000);
