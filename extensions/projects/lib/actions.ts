import { basename, dirname } from "node:path";
import { type PairEntry, pairList, pairOpen, pairServer, type Run } from "../../../shared/pair.ts";
import { type Item, openItems, parseWorktrees, recentItems, type Scope, worktreeItems } from "./model.ts";

const requirePair = (env: NodeJS.ProcessEnv) => {
  if (!env.PI_PAIR_COMMAND) {
    throw new Error("/switch: PI_PAIR_COMMAND is not set. Start pi again in a new tmux pane, or set it to the pair script of zerodawn-tmux.");
  }
};

const fail = (what: string, result: { code: number; stderr: string }) => new Error(`${what} failed (exit ${result.code}): ${result.stderr.trim()}`);

export async function loadItems(run: Run, env: NodeJS.ProcessEnv = process.env): Promise<Record<Scope, Item[]>> {
  requirePair(env);
  const open: PairEntry[] = await pairList(run, env);
  const recent = await run("zoxide", ["query", "-l"]);
  if (recent.code !== 0) throw fail("zoxide query -l", recent);
  const projects = recentItems(
    recent.stdout
      .split("\n")
      .filter((l) => l !== "")
      .slice(0, 30),
    open,
  );
  const listed = await run("git", ["worktree", "list", "--porcelain"]);
  const worktrees = listed.code === 0 ? worktreeItems(parseWorktrees(listed.stdout), open) : [];
  return { open: openItems(open), worktrees, projects };
}

export async function switchTo(run: Run, pane: string | undefined, path: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!pane) throw new Error("/switch: $TMUX_PANE is not set; start pi inside tmux.");
  requirePair(env);
  const { server } = await pairServer(run, pane);
  if (!server) throw new Error("/switch: this tmux client has no nvim pair. Run /ide to start it, then switch again.");
  await pairOpen(run, server, path, env);
}

export const slug = (name: string): string =>
  name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export async function newWorktree(run: Run, name: string): Promise<string> {
  const branch = slug(name);
  if (branch === "") throw new Error("new worktree: the branch name is empty. Give a name with letters or digits.");
  const common = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) throw fail("git rev-parse", common);
  const root = common.stdout.trim().replace(/\/\.git$/, "");
  const path = `${dirname(root)}/${basename(root)}-${branch}`;
  const added = await run("git", ["worktree", "add", "-b", branch, path]);
  if (added.code !== 0) throw fail(`git worktree add -b ${branch} ${path}`, added);
  return path;
}

export async function removeWorktree(run: Run, item: Item): Promise<void> {
  const removed = await run("git", ["worktree", "remove", item.path]);
  if (removed.code !== 0) {
    throw new Error(`git worktree remove ${item.path} failed: ${removed.stderr.trim()}. Commit or stash the changes there, or remove it by hand with --force.`);
  }
  if (item.window) await run("tmux", ["kill-window", "-t", item.window]);
}
