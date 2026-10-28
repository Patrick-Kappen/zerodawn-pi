import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { config } from "../../shared/config.ts";
import { Debugger } from "./lib/session.ts";

const Params = Type.Object({
  action: Type.Union(
    ["start", "continue", "step_over", "step_into", "step_out", "eval", "stop"].map((a) => Type.Literal(a)),
    { description: "start, continue, step_over, step_into, step_out, eval or stop." },
  ),
  file: Type.Optional(Type.String({ description: "start: the program or test file to debug." })),
  breakpoints: Type.Optional(
    Type.Array(
      Type.Object({
        file: Type.String(),
        line: Type.Number({ description: "1-based line." }),
        condition: Type.Optional(Type.String()),
      }),
      { description: "start: breakpoints to set." },
    ),
  ),
  adapter: Type.Optional(Type.String({ description: "start: nvim-dap adapter (pwa-node, delve, python). Default: from the file extension." })),
  args: Type.Optional(Type.Array(Type.String(), { description: "start: program arguments." })),
  expression: Type.Optional(Type.String({ description: "eval: expression to evaluate in the current frame." })),
});

export default function (pi: ExtensionAPI) {
  const server = process.env.PI_DEBUG_SERVER;
  if (!server) return;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const make = (cwd: string) =>
    new Debugger({
      run: async (command, args) => {
        const r = await pi.exec(command, args, { cwd });
        return { code: r.code, stdout: r.stdout, stderr: r.stderr };
      },
      sleep,
      now: Date.now,
      nvim: config().nvim ?? "nvim",
      server,
    });
  let dbg: Debugger | undefined;

  pi.registerTool({
    name: "debug",
    label: "debug",
    description:
      "Debug a program or failing test in the user's Neovim with nvim-dap. start {file, breakpoints:[{file,line,condition?}], adapter?, args?} runs to the first stop; continue, step_over, step_into, step_out resume; eval {expression} evaluates in the current frame; stop ends the session. A stop shows the reason, location, source line, stack, locals and program output. Always stop when done.",
    promptSnippet: "Debug a program or test with breakpoints, stepping and eval through nvim-dap",
    parameters: Params,

    async execute(_id, params, _signal, _onUpdate, ctx) {
      dbg ??= make(ctx.cwd);
      const abs = (f: string) => resolve(ctx.cwd, f);
      let text: string;
      switch (params.action) {
        case "start":
          if (!params.file) throw new Error("debug: start needs file");
          text = await dbg.start(
            {
              file: abs(params.file),
              breakpoints: (params.breakpoints ?? []).map((b) => ({ ...b, file: abs(b.file) })),
              adapter: params.adapter,
              args: params.args,
            },
            ctx.cwd,
          );
          break;
        case "eval":
          if (!params.expression) throw new Error("debug: eval needs expression");
          text = await dbg.evaluate(params.expression);
          break;
        case "stop":
          text = await dbg.stop();
          break;
        default:
          text = await dbg.step(params.action);
      }
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.on("session_shutdown", async () => {
    await dbg?.shutdown();
  });
}
