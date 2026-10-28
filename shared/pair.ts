export type RunResult = { code: number; stdout: string; stderr: string };
export type Run = (command: string, args: string[]) => Promise<RunResult>;

export type PairEntry = { repo: string; worktree: string; window: string; agent: boolean };

// PI_PAIR_COMMAND: the pair script of zerodawn-tmux (default: "pair" on PATH). PI_PAIR_TMUX: the tmux wrapper for --tmux.
export function pairCommand(env: NodeJS.ProcessEnv = process.env): { command: string; prefix: string[] } {
  const tmux = env.PI_PAIR_TMUX;
  return { command: env.PI_PAIR_COMMAND || "pair", prefix: tmux ? ["--tmux", tmux] : [] };
}

export function parseList(text: string): PairEntry[] {
  const entries: PairEntry[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const parts = line.split("\t");
    if (parts.length !== 4) {
      throw new Error(`pair list: expected REPO<TAB>WORKTREE<TAB>WINDOW<TAB>AGENT, got "${line}". Update the zerodawn-tmux pair addon.`);
    }
    entries.push({ repo: parts[0], worktree: parts[1], window: parts[2], agent: parts[3] === "1" });
  }
  return entries;
}

export async function pairRun(run: Run, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<RunResult> {
  const { command, prefix } = pairCommand(env);
  return run(command, [...prefix, ...args]);
}

export async function pairList(run: Run, env: NodeJS.ProcessEnv = process.env): Promise<PairEntry[]> {
  const result = await pairRun(run, ["list"], env);
  if (result.code !== 0) {
    throw new Error(`pair list failed (exit ${result.code}): ${result.stderr.trim()}. Is PI_PAIR_COMMAND the pair script and tmux running?`);
  }
  return parseList(result.stdout);
}

// The tmux client of this pane and the nvim server it is paired with; the server is undefined without a pair.
export async function pairServer(run: Run, pane: string): Promise<{ client: string; server: string | undefined }> {
  const client = (await run("tmux", ["display-message", "-p", "-t", pane, "#{client_name}"])).stdout.trim();
  if (client === "") throw new Error(`no tmux client is attached to pane ${pane}. Attach a client, then run the command again.`);
  const server = (await run("tmux", ["show-option", "-gqv", `@pair-${client}`])).stdout.trim();
  return { client, server: server === "" ? undefined : server };
}

export async function pairOpen(run: Run, server: string, dir: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const result = await pairRun(run, ["open", server, dir], env);
  if (result.code === 0) return;
  if (result.code === 3) throw new Error(`no tmux client is paired with the nvim server ${server}. Run /ide to start the pair.`);
  throw new Error(`pair open ${dir} failed (exit ${result.code}): ${result.stderr.trim()}`);
}
