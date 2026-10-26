# Agent profiles (proposal)

Status: proposal. Nothing reads profiles yet.

An agent profile defines everything a subagent gets beyond the fixed base. One file per agent type.

## Place

- Only `~/.pi/agent/agents/<name>.md`. Repositories do not hold profiles.
- A missing profile is an error that names the path. There is no fallback profile.
- Later, nullspace delivers the same files: its layer kind `agents/` copies `layers/*/agents/<name>.md` as is. The format belongs to this extension, not to nullspace.

## Fixed base (not in a profile)

- `pi -ne -ns -np -nc --no-themes`: no discovery of extensions, skills, prompt templates, context files or themes.
- `-e` the subagents extension (channel to the supervisor).
- `-e` each path of `subagentExtensions` in `config.json` (provider login).
- `--tools` from the profile, so `defaultTools` in `settings.json` has no effect.

## Format

Frontmatter, then the prompt text.

```markdown
---
description: Read-only scout. Finds files and facts for a task, changes nothing.
models:
  - opencode/claude-haiku-5-5:off
  - anthropic/claude-haiku-5-5:off
tools: [read, grep, bash]
extensions: [bash, files]
skills: []
mcp: []
system: replace
checks: []
---
You are a scout. ...
```

| Key | Required | Meaning |
|---|---|---|
| `description` | yes | When to use this profile. The main agent reads it to choose a profile. |
| `models` | yes | Model ladder, `<provider>/<model>[:<thinking>]`. The tool takes the first available one. |
| `tools` | yes | Exact tool set, passed as `--tools`. `[]` is no tools. |
| `extensions` | yes | Extensions of this package by name (`bash`, `files`, `tests`, ...), or absolute paths. Loaded with `-e`. |
| `skills` | yes | Skill names or absolute paths. Loaded with `--skill`. |
| `mcp` | yes | MCP server names. Empty list: `--no-mcp`. |
| `system` | yes | `replace`: the body replaces the pi system prompt. `append`: the body goes after it. |
| `checks` | yes | Extra commands that must pass before the agent is done, after the repository tests. |

Every key is required, so a profile shows all that the agent gets. An unknown key is an error.

## Open questions

- Where do skill names resolve to: `~/.pi/agent/skills/`, or the skills of this package?
- How does a profile select MCP servers when `~/.pi/agent/mcp.json` holds them all?
- Does `extensions` by name resolve against the installed package or the worktree (`just dev`)?
