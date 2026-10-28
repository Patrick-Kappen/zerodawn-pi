# Fix the models: key in agent profiles so subagents start

The profiles have a `models:` key, but the extension rejects it. So no subagent starts. Move the profiles to the model ladder, or let a profile name one model.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- `subagents`: every profile in `~/.pi/agent/agents/` has a `models:` key, and the extension rejects that key. No subagent starts, and `config.json` with `subagentModels` does not exist. Move the profiles to the model ladder, or allow one model per profile.
