import { createConnection } from "node:net";

export function answers(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createConnection(path);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") resolve(false);
      else
        reject(new Error(`subagents: could not probe socket "${path}": ${error.message}. Remove the file by hand when no supervisor runs.`, { cause: error }));
    });
  });
}
