#!/usr/bin/env node
// Stands in for pi in tests: connects with the env vars, answers a task with fake events and a settle.
import { createConnection } from "node:net";

const socket = createConnection(process.env.PI_SUBAGENT_SOCKET);
const id = process.env.PI_SUBAGENT_ID;
const send = (message) => socket.write(`${JSON.stringify(message)}\n`);
let buffer = "";
socket.setEncoding("utf8");
socket.on("connect", () => send({ type: "hello", role: "sub", id }));
socket.on("data", (chunk) => {
  buffer += chunk;
  for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
    const message = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (message.type !== "task") continue;
    send({ type: "event", event: { kind: "tool_start", name: "bash", args: "x".repeat(200) } });
    send({ type: "event", event: { kind: "tool_end", name: "bash", isError: false } });
    send({ type: "event", event: { kind: "message", text: "working", usage: { tokens: 7, cost: 0.01 } } });
    send({ type: "event", event: { kind: "settled", text: `answer to: ${message.task}` } });
  }
});
socket.on("close", () => process.exit(0));
setInterval(() => {}, 1000);
