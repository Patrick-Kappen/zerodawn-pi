import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { applyEvent, emptyRun, parseModels, type Run, report } from "./events.ts";

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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "opencode",
    label: "opencode",
    description: `Give one task to an OpenCode agent that works in the same project and returns a short report. It can read, edit, search and run tests. It cannot commit, push, delete files or work outside the project. A model ID that OpenCode does not know gives the list of models. Models under opencode/ are free and their list changes. Pass the returned session ID to continue the same agent.`,
    promptSnippet: "Give one task to an OpenCode subagent on a free or OpenCode Go model",
    promptGuidelines: [
      "Use opencode for a clear task that does not need this session's context, so its reads stay out of your context.",
      "Give the opencode task all the context it needs; the OpenCode agent does not know this session.",
      "Check the changes of the opencode agent with git diff and the tests before you continue.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "The complete task, with all the context the agent needs." }),
      model: Type.String({ description: "OpenCode model ID, for example opencode/big-pickle." }),
      session: Type.Optional(Type.String({ description: "Session ID of an earlier opencode call to continue it." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const known = await models(ctx.cwd, signal);
      if (!known.includes(params.model)) {
        throw new Error(`opencode: unknown model "${params.model}". Use one of: ${known.join(", ")}`);
      }
      const args = ["run", "--standalone", "--agent", AGENT, "--auto", "-m", params.model, "--format", "json"];
      if (params.session) args.push("--session", params.session);
      const result: Run = emptyRun();
      const exit = await run(
        args,
        ctx.cwd,
        params.task,
        (line) => {
          const progress = applyEvent(result, line);
          if (progress) onUpdate?.({ content: [{ type: "text", text: progress }], details: {} });
        },
        signal,
      );
      if (signal?.aborted) throw new Error(`opencode: stopped by the user. Session: ${result.session}`);
      if (exit.timedOut) throw new Error(`opencode: stopped after ${TIMEOUT_MS / 60_000} minutes. Session: ${result.session}`);
      if (exit.code !== 0) throw new Error(`opencode: ${BIN} exit ${exit.code}: ${tail(exit.stderr)}`);
      if (result.errors.length) throw new Error(`opencode: ${result.errors.join("\n")}\nSession: ${result.session}`);
      if (!result.session) throw new Error("opencode: the output has no session ID. Check the OpenCode version.");
      if (!result.text.length) throw new Error(`opencode: the agent gave no answer. Session: ${result.session}`);
      return {
        content: [{ type: "text", text: report(result) }],
        details: { model: params.model, session: result.session, tools: result.tools, tokens: result.tokens, cost: result.cost },
      };
    },
  });
}
