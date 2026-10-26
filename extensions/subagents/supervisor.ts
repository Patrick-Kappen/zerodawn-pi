import { execFile } from "node:child_process";
import { parseArgs } from "./lib/args.ts";
import { startSupervisor } from "./lib/server.ts";
import { createTmux, type Exec } from "./lib/tmux.ts";

const exec: Exec = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 127;
      resolve({ stdout, stderr: error !== null && code === 127 ? `${stderr}${error.message}` : stderr, code, killed: false });
    });
  });

try {
  const args = parseArgs(process.argv.slice(2));
  const supervisor = await startSupervisor({
    ...args,
    runtimeDir: process.env.XDG_RUNTIME_DIR,
    tmux: createTmux(exec),
    timers: { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) },
  });
  process.on("SIGTERM", supervisor.stop);
  process.on("SIGINT", supervisor.stop);
  await supervisor.done;
  process.exit(0);
} catch (error) {
  console.error((error as Error).message);
  if ((error as Error).cause !== undefined) console.error(`cause: ${((error as Error).cause as Error).message}`);
  process.exit(1);
}
