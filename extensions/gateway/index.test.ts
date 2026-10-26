import assert from "node:assert/strict";
import { test } from "node:test";
import gatewaySession, { SESSION_HEADER } from "./index.ts";

type Handler = (event: { headers: Record<string, string> }, ctx: unknown) => void;

function run(headers: Record<string, string>) {
  const handlers: Record<string, Handler> = {};
  const pi = { on: (name: string, handler: Handler) => (handlers[name] = handler) };
  gatewaySession(pi as never);
  const ctx = { sessionManager: { getSessionId: () => "sess-1" } };
  handlers.before_provider_headers({ headers }, ctx);
  return headers;
}

test("adds the session id to requests for the gateway", () => {
  assert.equal(run({ "x-gateway-key": "k" })[SESSION_HEADER], "sess-1");
});

test("leaves requests to other endpoints unchanged", () => {
  assert.deepEqual(run({ authorization: "Bearer t" }), { authorization: "Bearer t" });
});
