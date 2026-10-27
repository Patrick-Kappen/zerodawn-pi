# Design: subagents with and without nullspace

Status: accepted by the user on 2026-10-27, with the decisions below. Owner of the code: zerodawn-pi (extension `subagents`). Review: nullspace lead agent.

## Decisions of the user

1. Extensions and rules of a child: not from the agent dir. The user manages them through nullspace (NSP). Until then, a child starts as now: `-ne -nc`, the profile's extensions and `subagentExtensions`.
2. Model: never the model of the main pi. For now the ladder is `opencode-go/deepseek-v4.1-flash:low`, then `anthropic/claude-sonnet-5-5:low`. Later the list comes from the layer.
3. A child never lives longer than its session.
4. PR #73 (dev environment): it must work; no conditions from the user.

## Goal

A subagent uses the same files as its main pi: the same agent dir, settings, models, rules and login.
Under nullspace, that is the layer of the client and repo of the session. Without nullspace, it is `~/.pi/agent`.
A subagent never sees more than its main pi. Nothing about agents is in nixos-config or the Home Manager module.

## Principle: a subagent is a descendant of its main pi

Every process of the extension (tmux server, supervisor, children) starts from the main pi process.
So each one inherits the sandbox, the environment and `PI_CODING_AGENT_DIR` of the main pi.
The extension never connects to a process or a server that the main pi did not start.

## Answers

### 1. tmux server (sandbox escape)

- The extension uses its own tmux server with an explicit socket: `tmux -S <runtime>/tmux.sock`. It never uses the default socket of the user.
- The main pi starts that server, so the server runs in the sandbox of the main pi (same mount, PID and network namespace).
- Under nullspace, `/tmp` is private to the run. A tmux server outside the sandbox cannot be reached, and the user's own server is not visible.
- When the run ends, bwrap ends the PID namespace. The server, the supervisor and all children stop with it. A subagent does not live longer than its session.
- Need from nullspace: the `tmux` binary in the sandbox and a working `/dev/pts`.

### 2. Worktrees

- The worktree root comes from the environment variable `PI_SUBAGENT_WORKTREES`.
- nullspace sets it to a dir that the session can write, per client and repo (for example `<state>/<client>/<repo>/worktrees`), and binds it read-write.
- Without the variable, the root is `~/.worktrees/<repo>` (as now).
- git also writes in the main repository: `.git/worktrees/<name>`, objects and refs. The session already has its own repo read-write.
- A worktree root that does not exist or is not writable is an error at start that names the variable and the path.

### 3. Runtime files

- Register, socket and tmux socket go to `<runtime>/pi-sub-<session8>/`. `<runtime>` is `$XDG_RUNTIME_DIR` when set, else `/tmp`.
- All processes run in the same sandbox, so they see the same private `/tmp`. The supervisor finds its register and socket.
- Cleanup of merged worktrees reads only the registers of this run. Agents of other runs are not visible and are not needed.

### 4. Profiles

- The extension reads profiles from `<agent dir>/agents/<name>.md`. The agent dir comes from pi's `getAgentDir()`, which obeys `PI_CODING_AGENT_DIR`.
- nullspace delivers the dir as a layer kind `agents/` (read-only), merged global, then client, then repo, like the other layers.
- Without nullspace, it is `~/.pi/agent/agents`.
- No profile dir, or no profile with that name: error that names the agent dir and the profile path.

### 5. Model

- The ladder moves from `config.json` to `settings.json` of the agent dir, as the key `subagents.models` (a list of `provider/id[:thinking]`).
- So the model comes from the same place as the main pi's model: the layer of the session.
- The model of the main pi is never used (decision 2). No list is an error that names the file and the key.
- Availability, probe and restart on a provider error stay as in decision 23.

### 6. Login and extensions (not accepted: decision 1)

The text below was the proposal. The user manages extensions and rules through nullspace instead.

- A child starts with the same agent dir. So it has the same `auth.json` login, settings, packages and extensions as the main pi.
- The child loads the extensions of the agent dir as the main pi does. So `-ne` and `subagentExtensions` go. A provider login extension loads by itself.
- The role stays strict: `--tools` is an allowlist that also filters extension tools. The child only has the tools of its profile and the fixed tools (`ask`, `blocker`, `handoff`, `continue`, `done`).
- Rules: `-nc` goes. The child gets the same rules as the main pi: under nullspace through the context loader extension, without nullspace through pi's normal `AGENTS.md` discovery from the worktree.
- `-ns` and `-np` stay off for skills and prompt templates, except what the profile names. A subagent does not need them, and they cost context.

## Profile format (from this design on)

```markdown
---
description: One line: what this role does. The main agent sees it.
extensions: [files, bash]
tools: [read, edit, write, bash]
skills: [name]            # optional, from <agent dir>/skills
checks: [just check]      # optional, the done gate; default: the tests of the changed files
---
The system prompt of the role.
```

- No `models`: the model comes from the ladder.
- `extensions` stays until nullspace manages the extensions (decision 1).
- An unknown key is an error that names the profile path and the key.
- Existing profiles: remove `models`.

## Task scope

This is a separate problem, but the design must make room for it. Subagents now read too much, because the main agent writes "read AGENTS.md and the README" in the task, and nothing limits the child.

- A task never has to say "read AGENTS.md": the rules of the role are in the profile, and later nullspace delivers the rules.
- The tool `start` gets a fixed task form: `goal` (one sentence), `files` (what the child may change), `done` (when it is finished), `context` (optional, short facts).
- The child cannot leave its worktree. The extension blocks paths outside the worktree in its tools. Under nullspace, the sandbox is the outer limit.

## What changes in zerodawn-pi

| Now | After |
|---|---|
| default tmux socket | `tmux -S <runtime>/pi-sub-<session8>/tmux.sock` |
| `~/.worktrees/<repo>` | `PI_SUBAGENT_WORKTREES`, else `~/.worktrees/<repo>` |
| `/tmp/pi-sub-<id>` | `$XDG_RUNTIME_DIR` or `/tmp`, `pi-sub-<session8>` |
| `~/.pi/agent/agents` | `getAgentDir()/agents` |
| `subagentModels` default: qwen, deepseek free, deepseek go, luna, sol, sonnet | for now: deepseek go `:low`, then sonnet 5.5 `:low`; later `subagents.models` in the layer |
| `subagentExtensions`, `-ne`, `-nc` | no change until nullspace (decision 1) |
| profile `models` | removed (already in 0.8.0) |

Order of the work, one PR each: the ladder for now; PR #73 working; profiles from `getAgentDir()`; tmux socket and runtime dir; worktree root; task form and worktree limit. With nullspace stage 4: model list from the layer.

## What nullspace does

- Put `tmux` in the sandbox, with `/dev/pts`.
- Set `PI_SUBAGENT_WORKTREES` and bind that dir read-write per client and repo.
- Deliver `agents/` as a layer kind.
- Put `subagents.models` in the `settings.json` layer when a client or repo wants a ladder.

## Open points for review

1. Does nullspace allow a tmux server with a PTY in the sandbox?
2. Per client and repo: is a worktree dir in the state dir correct, or must it be in the repo (for example `.git/pi-worktrees`)?
3. Must a subagent get the skills of the layer automatically, or only what the profile names (this proposal)?
4. How nullspace gives a child its extensions and rules (decision 1).
