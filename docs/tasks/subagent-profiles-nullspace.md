# Let nullspace deliver agent profiles through its agents/ layer

Profiles now live in `~/.pi/agent/agents/`. Later nullspace must deliver the same files through its `agents/` layer.

## Source

- zerodawn-pi main: extensions/subagents/README.md (Plan)

## Original text

The steps are in `TODO.md`, one at a time.

- **Profiles:** `~/.pi/agent/agents/<name>.md` defines all that a subagent gets: tools, extensions, skills, MCP, system prompt, extra checks. Repositories hold no profiles. Later, nullspace delivers the same files through its layer kind `agents/`.

`just dev` reads the `config.json` of the installed package (through `ZERODAWN_PI_CONFIG`) and loads its `subagentExtensions` in the sandbox pi too. Set the Home Manager option `subagentExtensions` to your provider login extension, for example `anthropic-oauth/index.ts`.
