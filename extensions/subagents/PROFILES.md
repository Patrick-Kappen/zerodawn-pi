# Agent profiles (proposal)

Status: read by the tool since step 2; checks not run yet.

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

Frontmatter, then the prompt text. The prompt text replaces the pi system prompt (`--system-prompt`); the subagent gets no pi default prompt. An empty prompt text is an error.

```markdown
---
description: Read-only scout. Finds files and facts for a task, changes nothing.
models:
  - opencode/claude-haiku-5-5:off
  - anthropic/claude-haiku-5-5:off
extensions: [files, builtin:codemode]
tools: [read, grep, codemode]
skills: []
checks: []
---
You are a scout. ...
```

| Key | When absent | Meaning |
|---|---|---|
| `description` | error | When to use this profile. The main agent reads it to choose a profile. |
| `models` | error | Model ladder, `<provider>/<model>[:<thinking>]`. The tool takes the first available one. |
| `tools` | no tools, no MCP | Exact tool set, passed as `--tools`. `[]` is no tools. MCP tools by pattern, for example `mcp__github__*`. Without an `mcp__` entry the subagent starts with `--no-mcp`. |
| `extensions` | none loaded | Extension names, found in the packages that Home Manager installs: `~/.pi/agent/packages/*/extensions/<name>/index.ts`. `builtin:<name>` loads a pi builtin extension, for example `builtin:codemode`. Loaded with `-e`. Most tools come from these extensions. |
| `skills` | none loaded | Skill names, found only in `~/.pi/agent/skills/<name>`. A package delivers its skills there through Home Manager. Loaded with `--skill`. |
| `checks` | none run | Extra commands that must pass before the agent is done, after the repository tests. |

An absent key loads nothing for that part; the subagent starts with nothing. An unknown key is an error, so a typo does not load nothing in silence.

## Open questions

- MCP: with an `mcp__` entry, all servers of `~/.pi/agent/mcp.json` connect; the subagent only sees the chosen tools. Do a test of `--tools` with `mcp__` patterns.
