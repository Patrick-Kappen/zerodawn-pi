# Decisions

Short records of choices that shape the repository. Newest at the top.

## 27. A cheap model writes a hard handoff card; code adds the facts (2026-10-27)

Long sessions cost most: every request reads 100k to 250k tokens, and free-text summaries lose details or keep old ones. A handoff is a card with fixed fields that a cheap model writes through one tool, from a stripped transcript (text and one line per tool call, no tool output). Facts that code can read (branch, dirty files, worktrees, PRs, jobs) come from code, not from the model. Done work drops out of the card. The handoff is a file, so a new session or another agent can take it. Tests in the sandbox showed: `ctx.compact` refuses small sessions and keeps a tail, but a `compaction` draft with `firstKeptEntryId: null` at `agent_before_settle` removes the old context completely; pi waits for an async `session_shutdown` handler, so `/quit` can update the card. The automatic cut between 130k and 150k comes in a later step.

## 26. The full test suite runs before each commit (2026-10-27)

The pre-commit hook `tests` runs `bun test` over the whole repository, with the same tools on PATH as the nix test checks. Reason: a failing test shows at the commit, not after the push in CI. The checker extension therefore does not ask whether tests ran. Cost: every commit waits for the suite, and the nix `pre-commit` check runs the suite again next to the `tests-<name>` checks.

## 25. A classifier decides at settle time whether the agent is done (2026-10-27)

Agents report an error in scope, ask a question they can answer themselves, or stop halfway, and call that done. The `checker` asks a classifier model on `agent_before_settle`, so it sees the whole run once and can request one more turn through pi, without a user message. The classifier only answers typed questions with probabilities. Fixed thresholds in code make the decision, so a change of behaviour is a code change with a test. A limit of 3 follow-ups in a row stops a loop between agent and classifier. A tool call sets the count back to 0, because a long run with one user message made progress and must be checked to its end. Every check goes to a JSONL log, to tune the thresholds on real runs. Cost: one classify call per finished run.

## 24. Tests and gates run in the dev environment of the project (2026-10-27)

pi keeps the environment of the shell it started in. A test run in another project, or in a subagent worktree, got that environment and missed the tools of its own dev shell (for example `bun`). `run_tests`, the check commands and the done gate now run the command through `direnv exec <git root>` when the git root has an `.envrc`. direnv allows an `.envrc` per path, so a new subagent worktree is blocked; the supervisor runs `direnv allow` on it only when the repo has the same `.envrc` content and the user allowed it there. This adds no new trust. A blocked `.envrc` fails the run with the direnv message; there is no fallback to the pi environment.

## 23. The tooling picks the subagent model, by availability only (2026-10-27)

One ladder `subagentModels` in the config serves all agents; profiles have no `models`. The agent does not choose or know its model: a model that picks its own model picks the strongest, and a list per profile repeats the same order in every file. The tooling takes the first entry that exists, has auth and answers a probe, and restarts on the next entry after a provider error, in the same worktree. Reason for availability only: it works without data. Quota (use left, reset time) and escalation on failure need numbers and a failure rule that do not exist yet; they come later and obey this order. Cost: a restart loses the context of the old agent; the task line and the changed files carry the work over.

## 22. edit and write run the formatter of the project (2026-10-27)

A syntax error has no safe automatic fix: tree-sitter knows where the error is, not what the agent meant. Format is safe, and it removes lint errors that came up only later in `just check`. Only the formatter that the project configures runs, so a repository without one keeps its own style. Its binary comes from the project (`node_modules/.bin`) or `PATH`, so the version is the one the project uses, not one from the Home Manager module. A configured formatter that is missing fails before the change, so the file does not change. Cost: lines that the formatter changed are no longer the same as the model's copy. The result says so, and the read check of decision 20 sends those lines again.

## 21. edit and write undo a change that adds a syntax error (2026-10-27)

SWE-agent rejects an edit that breaks the syntax, and its agents then fix the edit at once. Here 7.6% of edits failed, and an edit with broken syntax shows up only later, in a test or a check. The check uses tree-sitter in headless nvim: one `nvim --clean -l` call parses the old and the new content in about 50 ms. nvim is a program on the machine, like ast-grep, not an npm dependency. Only errors that the old content did not have count, so a file that was already broken can still change. A change with new errors is undone, so the file and the model's copy of it stay the same. A missing nvim or grammar fails the tool with the Home Manager option to set, because a check that skips itself hides a broken setup. The Lua script is a string in `syntax.ts`, because the package contains only `.ts` files. Rejected: a type check with tsc or an LSP, because it is slow, it needs the project, and a type error in the middle of a change of several edits is normal.

## 20. read sends only new lines, in small ranges; bash does not show files (2026-10-27)

A session analysis (18–26 Oct) showed where the context goes. 46% of the read characters after the bash change were full reads of bash output logs. 79 of 110 of these came after a successful `cat`, `head` or `grep` in bash: the agent read files through bash, bash cut the output, and the agent read the log in full. Reads used `limit 400–2000` to get a whole file, and 1187 reads came after the agent's own edit. The model follows Anthropic's tool guidance (ranges, filters, cut results that name the next step), SWE-agent (a small file window and search commands) and the Aider repo map (an outline lets the agent pick a range). Thus: bash blocks a file viewer whose output goes to the model. read gives an outline for a big file without a range, caps `limit` at 200 lines and 16 KB, and takes `offset=-N` for the end of a log. read, edit and write store line hashes of what they put in context in the result `details`. A new read takes the model context from `buildSessionProjection()`, so a pruned, omitted or compacted result does not count. Lines that are still in the file, at the same place or moved, are not sent again. A run of fewer than 3 matching lines does not count, so lines such as `}` do not split a result. Rejected: a state in memory, because it does not see prune, compaction or `/tree`; a block of reads with no new lines as an error, because a short note costs less than a retry.

## 19. A git worktree per subagent (2026-10-27)

Each subagent works in its own git worktree and branch `sub/<id8>` under `~/.worktrees/<repo>/`, and the subagent extension commits its work in the `handoff` tool. A copy or a clone was rejected: a worktree shares the object store, so the history stays and a branch is ready to merge with no fetch. A failed or unfinished agent keeps its worktree and its commit, so its data is not lost; only an agent without changes leaves nothing behind. The main pi resolves `base` to a commit hash because it knows the cwd; the supervisor only gets a repo and a hash. The subagent commits, with a subject that it writes itself, because the repository hook is the only rule for a subject: a fixed supervisor subject was refused by a hook `<scope>: <what>`. A refused commit gives the git output to the model, which calls `handoff` again; this counts as an invalid call, so 2 refusals fail the agent. The `Change:` trailer always applies. `--no-verify` is not allowed. Cost: `answer` fails for an agent whose empty worktree was removed.

## 18. The subagent chooses `done`; one `handoff` is the only result (2026-10-27)

Replaces 17. A forced `done` after a green gate made the model write the result at a moment it did not choose, and two tools (`done`, `done_findings`) split one result in two. Now the model says "the task is finished" with `done {}`, always active. Each settle without `done`, `ask` or `blocker` forces a choice (`continue`, `done`, `ask`, `blocker`) with "any tool" in the provider request (`forceAnyTool`); there is no count, the token limit ends a loop. `done` starts the gate. A green gate, the 3rd red gate and the token limit all force the same `handoff` schema. It has `findings`, so a task without changes needs no second tool, and a git check of `changes` and `findings` at call time keeps the data true. After a valid handoff nothing goes to the agent. The supervisor gives status `idle` for a green gate and `handoff` otherwise. The tools are restored at the next `answer`, which fixes a handoff after the token limit that left only `handoff` active.

## 17. Subagent `done` is enforced, with two tools (2026-10-27)

Replaced by 18.

A green gate no longer sends the last assistant text. The subagent extension forces the tool `done` the same way as `handoff`. A tool schema cannot have a root `anyOf` (the main tool `subagent` shows why: the model sent empty arguments). So there are two tools: `done` for changed files and `done_findings` for a scout. The gate picks the tool. `done` also checks `changes[].file` against `git` at call time, so the model cannot invent or skip a file. The extension, not the model, adds the gate data (files, test line).

## 16. Subagent handoff is enforced, not asked for (2026-10-27)

A steer message did not make models write a usable handoff. The subagent extension now aborts the run, activates only the tool `handoff`, and forces it with the tool choice in `before_provider_request`. The payload shape comes from the declared tools, because the model name does not tell the API. An unknown shape fails the agent. `ask`, `blocker` and `handoff` have strict schemas so the main agent gets structured data.

## 15. The version level comes from a Change trailer per commit (2026-10-27)

Every commit carries `Change: fix|feature|breaking`. `bump-changed` takes the highest change per component since its last tag: fix is patch, feature is minor, breaking is major (minor below 1.0, marked "(breaking)" in the changelog). Reason: a hand-picked level for the whole release gave a minor for each small fix. Commits from before the rule have no trailer; `bump-changed <change>` gives them a change on purpose, without it they fail. Releases happen for a deliverable or on request, not after every PR.

## 14. Subagent profiles live only in ~/.pi/agent/agents (2026-10-26)

A subagent gets its prompt, models, tools, extensions, skills and MCP from a profile in `~/.pi/agent/agents/<name>.md`. Repositories hold no profiles. Reason: one place that the user controls, and the same files that nullspace will deliver later through its layer kind `agents/`. The format belongs to the `subagents` extension (`extensions/subagents/PROFILES.md`). Rejected: profiles in `.pi/agents/` of a repository, and the nullspace `presets/` format (fixed keys for the `/preset` mode of the main pi).
## 13. Every bash command becomes a background job after 15 s (2026-10-26)

The `bash` tool waits at most `INLINE_WAIT_S` for a command. A command that ends in time returns its result. A longer one returns the job id, and a `bash-job` message reports the result. The agent does not choose. A result is the status with at most `INLINE_LINES` lines of output; more gives size and path. A failure adds every distinct line that looks like an error, or the last `TAIL_LINES` lines when none does. Reason: with `background` as an option, the agent used it in 3% of the calls and waited for everything else, and a third of the bash output in the context was file content from `cat`, `sed` and `grep`. The `ctx-manager` extension prunes `bash-job` messages like tool results, so a late result does not stay in the context forever.

## 12. A warning is an error; check commands run in place (2026-10-26)

`run_tests` and the check commands in bash (`just check`, `just lint`, `nix flake check`, linters) are red when the output has a warning. A check command runs in place of bash, with the same short result as the tests. `just lint` runs biome with `--error-on-warnings`, and `nix flake check` runs with `warn-dirty false`: a dirty tree is the normal state during work, not a fault. A project without bun tests gets the tests for its changes from a recipe `test-changed *files`; this repository has one (`scripts/test-changed.sh`). Reason: a warning that passes stays, and the agent read the full output of every check.

## 11. Tests run through the tool run_tests, not through bash (2026-10-26)

The extension `tests` registers `run_tests` and blocks test commands in bash. The tool picks the tests for the changed files, fails for a changed code file without a test, and returns one line for green or only the failures for red. Reason: the agent ran tests in many forms around the old block of a repeated run, and got the full output in its context.

## 10. A subagent starts with nothing (2026-10-26)

A subagent runs with `-ne -ns -np -nc --no-themes`. It loads only the subagents extension and the paths in `subagentExtensions` of `config.json`. Reason: later, agent files define prompt and tools, so the base must be empty. pi has no per-extension filter for packages in `settings.json`, so extensions are given explicitly with `-e`.

## 9. Subagents run as pi processes in tmux, owned by a supervisor (2026-10-26)

The `subagents` extension starts each subagent as a normal interactive pi in a window of a detached tmux session `pi-sub-<first 8 characters of the pi session id>`, one session per main agent. The user can attach and watch the real pi UI, and a hung subagent cannot block the main pi. A supervisor in window 0 owns the subagents; the main pi and the subagents are clients of its Unix socket. Reason: neither agent owns the lifecycle, so a subagent can finish after the main pi stops, and a 2 hour timer cleans up after a crash. Runtime state and subagent sessions go to `/tmp/pi-sub-<id>/`, so a reboot removes them. The supervisor runs under the runtime of pi (`process.execPath`), so it needs no extra dependency. No shell scripts and no `tmux send-keys`. Rejected: the SDK inside the main pi process (no own UI, a hang blocks the main agent), and `--mode json` or `--mode rpc` in tmux (the pane shows JSON, not the pi UI).

## 8. Release workflow: feature PRs do not bump, one release PR bumps what changed (2026-10-25)

Feature PRs merge continuously. `just bump-changed` bumps every extension that changed since its last tag, and the package, and writes the changelog sections from the commit subjects. CI runs `release-check` only on a PR that changes the package version, and tags only on its merge. Reason: several PRs can land between releases without version conflicts, and the tags still mark what was tested together.

## 7. Changelog from commit subjects (2026-10-25)

A commit subject starts with the extension name (`bash: …`). The changelog per extension and the root changelog are generated from those subjects at release time and can be edited in the release PR. Reason: no manual changelog work per PR, and the release notes stay complete.

## 6. Extension directories are named after what the user sees (2026-10-25)

`bash`, `git`, `files`, `opencode`, `ast-grep` for tools; `core` (`/ext`), `ui`, `tests`, `ctx-manager`, `systemstate`, `watchdog`, `gateway` for behaviour. Tool and command names inside pi do not change with a directory name.

## 6. bash jobs run without a terminal (2026-10-26)

A job ran in a PTY under `script`. Programs saw a terminal and started pagers, editors and raw-mode prompts, which waited until the time limit. Now a job runs like in CI: stdout and stderr go to the log file, stdin is `/dev/null`, the job has its own session without a controlling terminal, and `NON_INTERACTIVE` in `jobproc.ts` sets the env that known tools obey. A pager, editor or prompt fails at once with a visible error. `env --default-signal=PIPE` undoes the ignored SIGPIPE that a Node child inherits, so `cmd | head` ends `cmd` instead of making it fail or spin. An open stdin with `jobs send` was tried and dropped: tools such as `rg` and `jq` read a stdin pipe instead of the working directory, and prompts that poll stdin are not detectable. Cost: tools that color only on a terminal print plain text.

## 5. A version per extension, one release unit (2026-10-25)

Every extension has a `package.json` with a version and gets a tag `<name>-v<version>`. The deploy unit stays the repository commit: one flake input, one lock. Per-extension versions mark what changed and drive `just compat`, which tests each extension's last release against the current `shared/`. Mixing versions of extensions in one install is not supported; `shared/` must stay backward compatible.

## 4. Every extension has tests, enforced by the flake (2026-10-25)

`nix flake check` has one derivation per extension (`tests-<name>`) with only that extension, `shared/` and the manifest as input, so an unchanged extension is a cache hit. The flake evaluation fails when an extension has no `package.json`, no version, or no `*.test.ts`.

## 3. Configuration comes from config.json, not from Nix placeholders (2026-10-25)

Extensions that need machine-specific values (`astGrep`, `nixosRepo`) read `config.json` next to `package.json`. The Home Manager module generates that file into the package. Without Nix, the user writes it by hand. Reason: one mechanism for both, no `@placeholder@` left in a plain checkout, and a wrong value fails with the file path.

## 2. settings.json is merged, not managed (2026-10-25)

pi and `/ext` write `~/.pi/agent/settings.json`. The Home Manager module adds the package path with an idempotent `jq` edit on activation and leaves the rest alone. A Nix-managed `settings.json` would break `/ext`.

## 1. One pi package, private extensions in a second repository (2026-10-25)

All extensions live in one package so that pi loads, toggles and reloads them. `ibm` and `anthropic-oauth` are in `zerodawn-pi-private` with the same layout, because they contain work infrastructure or should not be public. Nix installs both through the same kind of module.
