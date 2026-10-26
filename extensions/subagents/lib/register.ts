import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface AgentEntry {
  id: string;
  role: string;
  window: string;
  status: "starting" | "running" | "idle" | "failed" | "question" | "blocked" | "handoff";
}

export async function writeRegister(dir: string, agents: AgentEntry[]): Promise<void> {
  const target = join(dir, "register.json");
  const temp = join(dir, `register.json.${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(temp, `${JSON.stringify({ agents }, null, 2)}\n`);
    await rename(temp, target);
  } catch (cause) {
    throw new Error(`subagents: could not write "${target}". Make sure the directory is writable.`, { cause });
  }
}
