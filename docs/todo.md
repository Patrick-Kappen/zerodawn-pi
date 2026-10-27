# Open points

- Decide who owns the transcript rendering of tool calls: `bash` hides every tool call and result (`ui/render.ts`), `ui` draws them in `/view compact`. One of them should own it.
- Check live that pi emits `message_end` for messages from `pi.sendMessage`. If not, `bash` resends every job report after 20 s of idle time (`tool/jobs.ts`, `unconfirmed`).
- `watchdog` needs a classifier model (`PI_WATCHDOG_CLASSIFIER`, default `typesafe/jev-latest`). Without it the watchdog never aborts; decide on a default that works without a private gateway, or make it loud.
- `files` wraps pi's `edit` and matches the error text `Could not find`; a wording change in pi silently disables the indent fix.
- `core` (`/ext`) cannot toggle extensions that pi loaded with `-e` on the command line, only settings and packages.
- The dev sandbox (`just dev`) uses a fixed model name; make it a flag or read it from pi's settings.
- Checks through `just` only (`just check`, `just lint`, …), never by reading the full logs. The agent needs one or two lines: what ran, green or the first error. `bash` already cuts long output to head, error lines and tail; the recipes should print a one-line summary at the end so even that is enough.
- `subagents`: every profile in `~/.pi/agent/agents/` has a `models:` key, and the extension rejects that key. No subagent starts, and `config.json` with `subagentModels` does not exist. Move the profiles to the model ladder, or allow one model per profile.
- `bash`: the check interceptor runs only the check of a chained command (`git commit ... && just check`). The other parts do not run, with no message. Run the full command, or fail loud.
- Check live in v0.15.0: `pi -p` with a background job (`gh pr checks --watch`) waits for the result and prints a final report. In v0.14.0 it stopped halfway with empty output.
- Check live in v0.15.0: `run_tests` in another project or worktree runs in its dev shell. In v0.14.0 it failed with `bun: command not found`.
- `CONTRIBUTING.md` says `just bump-changed minor`, but the script takes `fix`, `feature` or `breaking` for commits without a trailer. Make the docs and the script agree.
- Profile `shipper`: give it a release task that obeys CONTRIBUTING, and make it stop to ask before a merge or release when the task says "check first".

- Make a correct skill for this repository, with in there a workflow, correct hooks, so the agent always knows how to handle this repository.

# Backlog

- New extension, working name `pick`: typing `$` in the chat opens a picker, like `@` for files. `$skill` inserts a skill, `$prompt` a prompt template, `$model` switches to a model with a saved setup (thinking level, tools, system prompt additions), `$profile` a named bundle of all of these. Generally everything that is now a slash command with arguments becomes pickable inline, with fuzzy search over one list. Needs: pi's editor hook for a trigger character, a registry of sources (skills, prompts, models, profiles from a config file), and one keystroke to confirm.
- A poller for the status after a push. It watches the PR checks, the merge, the release tags and `nix flake update` in nixos-config, and reports on its own: green as a small notification (active or in the history, to be decided), red with the error and nothing else. No more asking or checking by hand.
- A tool to restart all running pi sessions after a rebuild. It waits until each session is idle, closes it, and starts it again in the same session, so it loads the new version.
- Think of subagents / Agent profiles
- Think of orchastration and orchastration of orchastration
- Make nvimx open the file that the agent is editting preferably before the agent start changing stuff. I guess there are also tpyes of extensions that can help with that? https://github.com/aliou/nvim-pi
- Extension for a quick branch off conversation like /btw.
- A good CI/CD flow with agent it necesary
- Really fix the bash calls
