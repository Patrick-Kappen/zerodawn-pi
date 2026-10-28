import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyEvent, emptyRun, parseModels, type Run, report } from "./lib/events.ts";

const BIN = "opencode2";
const AGENT = "pi-worker";
const TIMEOUT_MS = 30 * 60_000;

type Exit = { code: number | null; stderr: string; timedOut: boolean };

function run(args: string[], cwd: string, input: string, onLine: (line: string) => void, signal?: AbortSignal): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { cwd, env: { ...process.env, PWD: cwd }, stdio: ["pipe", "pipe", "pipe"] });
    let rest = "";
    let stderr = "";
    let timedOut = false;
    let failure: unknown;
    child.stdout.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (failure) return;
        try {
          onLine(line);
        } catch (err) {
          failure = err;
          child.kill("SIGTERM");
        }
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const stop = () => child.kill("SIGTERM");
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, TIMEOUT_MS);
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`opencode: ${BIN} did not start: ${err.message}. Install OpenCode v2 and make sure ${BIN} is on PATH.`, { cause: err }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (failure) return reject(failure);
      if (rest.trim()) {
        try {
          onLine(rest);
        } catch (err) {
          return reject(err);
        }
      }
      resolve({ code, stderr, timedOut });
    });
    child.stdin.end(input);
  });
}

function tail(text: string): string {
  return text.trim().split("\n").slice(-5).join("\n");
}

async function models(cwd: string, signal?: AbortSignal): Promise<string[]> {
  let output = "";
  const exit = await run(["models"], cwd, "", (line) => (output += `${line}\n`), signal);
  if (exit.code !== 0) throw new Error(`opencode: "${BIN} models" exit ${exit.code}: ${tail(exit.stderr)}`);
  const list = parseModels(output);
  if (!list.length) throw new Error(`opencode: "${BIN} models" listed no models. Check the OpenCode configuration.`);
  return list;
}

async function work(task: string, model: string, session: string | undefined, cwd: string, signal: AbortSignal) {
  const args = ["run", "--standalone", "--agent", AGENT, "--auto", "-m", model, "--format", "json"];
  if (session) args.push("--session", session);
  const result: Run = emptyRun();
  const exit = await run(args, cwd, task, (line) => applyEvent(result, line), signal);
  if (signal.aborted) throw new Error(`opencode: stopped at the end of the session. Session: ${result.session}`);
  if (exit.timedOut) throw new Error(`opencode: stopped after ${TIMEOUT_MS / 60_000} minutes. Session: ${result.session}`);
  if (exit.code !== 0) throw new Error(`opencode: ${BIN} exit ${exit.code}: ${tail(exit.stderr)}`);
  if (result.errors.length) throw new Error(`opencode: ${result.errors.join("\n")}\nSession: ${result.session}`);
  if (!result.session) throw new Error("opencode: the output has no session ID. Check the OpenCode version.");
  if (!result.text.length) throw new Error(`opencode: the agent gave no answer. Session: ${result.session}`);
  return { text: report(result), details: { model, session: result.session, tools: result.tools, tokens: result.tokens, cost: result.cost } };
}

export default function (pi: ExtensionAPI) {
  // The runs outlive their tool call; the end of the session stops them.
  const runs = new Set<AbortController>();
  pi.on("session_shutdown", () => {
    for (const stop of runs) stop.abort();
  });
  const send = (content: string, details: Record<string, unknown>) =>
    pi.sendMessage({ customType: "opencode", content, display: true, details }, { triggerTurn: true, deliverAs: "steer" });
  pi.registerTool({
    name: "opencode",
    label: "opencode",
    description: `Give one task to an OpenCode agent that works in the same project and returns at once; a message gives its short report. Continue with other work, or end your turn when the next step needs the report. Use it for a clear task that does not need this session's context, so its reads stay out of your context. Check its changes with git diff and the tests before you continue. It can read, edit, search and run tests. It cannot commit, push, delete files or work outside the project. A model ID that OpenCode does not know gives the list of models. Models under opencode/ are free and their list changes. Pass the returned session ID to continue the same agent.`,
    promptSnippet: "Give one task to an OpenCode subagent on a free or OpenCode Go model",
    parameters: Type.Object({
      task: Type.String({ description: "The complete task, with all the context the agent needs." }),
      model: Type.String({ description: "OpenCode model ID, for example opencode/big-pickle." }),
      session: Type.Optional(Type.String({ description: "Session ID of an earlier opencode call to continue it." })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const known = await models(ctx.cwd, signal);
      if (!known.includes(params.model)) {
        throw new Error(`opencode: unknown model "${params.model}". Use one of: ${known.join(", ")}`);
      }
      const stop = new AbortController();
      runs.add(stop);
      work(params.task, params.model, params.session, ctx.cwd, stop.signal)
        .then(
          (done) => send(done.text, done.details),
          (err: Error) => send(`opencode: no report: ${err.message}`, { model: params.model }),
        )
        .finally(() => runs.delete(stop));
      return { content: [{ type: "text", text: `opencode: started on ${params.model}. A message gives the report.` }], details: { model: params.model } };
    },
  });
}
