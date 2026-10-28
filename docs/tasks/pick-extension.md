# Build the pick extension: $ picker for skills, prompts, models, profiles

Slash commands with arguments are slow to type. A `$` picker with fuzzy search over skills, prompts, models and profiles makes them one keystroke. It needs a trigger hook in pi's editor and a registry of sources.

## Source

- zerodawn-pi main: docs/todo.md (Backlog)

## Original text

- New extension, working name `pick`: typing `$` in the chat opens a picker, like `@` for files. `$skill` inserts a skill, `$prompt` a prompt template, `$model` switches to a model with a saved setup (thinking level, tools, system prompt additions), `$profile` a named bundle of all of these. Generally everything that is now a slash command with arguments becomes pickable inline, with fuzzy search over one list. Needs: pi's editor hook for a trigger character, a registry of sources (skills, prompts, models, profiles from a config file), and one keystroke to confirm.
