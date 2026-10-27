# Improvements

- UI: move the tool call view to `shared/`, so every extension uses it. It must show better what a tool call does.
- Research: how to run everything in the background, without trouble for the agent or the user.
- Tests: subagents (they load only `subagentExtensions`) and `opencode` run test and check commands without the `tests` extension, with the full output.


- Have a done check after every agent.

- New extension `handoff` (design from 2026-10-27):
  - A light background agent (free model, else luna-6 low) gets a stripped transcript (user and assistant text, tool calls as one line, no tool output) and one tool `write_card` with a hard JSON schema: goal, status, decisions, open, next, avoid, done (one line per PR or commit; done items drop out).
  - Code adds the system facts: open PRs, branch, worktrees, running jobs, dirty files.
  - Decider in code: task done gives a handoff. Cache expired, context under 100k and something runs: keep warm, max 30 min. Over 100k at a cache break, or about 150k in an active session: handoff. Mid-task: first tell the agent to finish the step.
  - Handoff as a compaction in the same session or as a new session (`newSession` with `parentSession`).
- `recall`: one question about an old session; a cheap model searches its stripped transcript and returns a short answer with entry ids. Later maybe long-term memory.
- Measure again a few days after the merges of 2026-10-27: cost per call, full cache rewrites, cache_warm entries, calls per tool. Then hide unused tools (codemode still finds them) or add a skill for a tool that is used wrong.
- Pi bug: `sdk.js` keeps cache warming only while each message object stays the same, and `buildSessionProjection` builds new objects for custom messages, context edits and compaction summaries. Nixos#382 patches it. Report it upstream; remove the patch when pi fixes it.
- `~/.pi/agent/settings.json` lists both packages twice: once with a filter, once without. Clean it up.

## Cost analysis 2026-10-21 to 2026-10-28 (23,082 calls, $1694; forked copies counted once)

- Reset per task: 75% of the cost came from calls with 150k context or more, 81% after user turn 7. After the changes of 2026-10-27: 7%. Keep it.
- Next lever is calls per task: 9.3 calls per user prompt after 2026-10-27, bash is half of the tool calls. Let the agent do small steps with little output between them, maybe driven by the SDK.
- Guardrails: 827 blocks (about $41) for `git status/log/diff`, `cat`, `grep`, `sed` in bash and checks run again. Each block costs a full call. Run the right tool and return its result, not a block.
- `sed -i` in bash: 241 times, past the edit tool and its syntax check. Send it to edit.
- Real errors: 858 (about $47). After 2026-10-27, 13% of the tool results are errors. Group them by cause and catch the frequent ones in an extension.
- Scripts for repeated work:
  - ADO API: the same `az account get-access-token` command 53 times.
  - PR flow: `gh pr` 161, `git fetch` 136, `git add`/`commit` 376. One recipe: open PR, wait for checks, merge.
  - Nix: `nix develop/build/eval/flake` about 475 times.
  - Session cost analysis as a recipe: dedupe forked messages by entry id and timestamp; per model, token type, context size, user turn, error cause and bash command.
- Skills: `skill_read` ran 13 times in all logs. Add skills for nixos-config ($375 in the week) and ADO/az. A skill of 10k tokens is cheaper than 20 attempts.
- Projects with many calls per prompt: harness_it 62, the containers worktree 42. Find the cause.
- Tests: 114 of 137 sessions with edits never ran `run_tests` (1878 edits, 169 runs). Run the tests automatically after edits, in the background, and report errors or one green line. Later LSP diagnostics.
- Debug tool: no extension has one. Only an old `debugger.ts` in the trash (`test_for_improve_agents`).
- Files: edit returns the changed lines with line numbers; write and read (outside the outline) give none. Force a read before an edit, with line-based and multi-file edits; read then must give line numbers.
- gpt-6-astra: $0.105 per call, $2.44 for input outside the cache. Find out why its cache misses.

### Tokens, speed and first time right (per user prompt, after 2026-10-27 19:40)

- First time right (no tool error, no checker follow-up, no user correction): 54% (week: 73%). A task that is not right the first time costs 3x ($0.51 vs $0.17), takes 9.5 calls instead of 2 and 1.4 min instead of 0.3 min.
- Guardrail blocks are 75 of 145 tool errors. Second: exit codes (28), codemode script failures (17).
- Speed: model time 59%, tool time 41%. A model call takes 4.5 s median, plus 1.6 s per 100 output tokens. One call less saves about 5 s.
- Output: 3.8k tokens per task, 32% reasoning. New context per task 18.8k, of which tool output 3.8k.
- Cache rewrites after idle: $403 in the week (24% of the cost), after the warming change $5. Keep it.
- Thinking level per step: `pi.setThinkingLevel()` exists. On Anthropic models with mid-conversation effort, low/medium/high switches keep the cache (11 of 11 within 5 min). Only off to on breaks it (haiku, 2 of 3). Do not switch to or from off.
- Tool output: median per result bash 42, edit 237, grep 338, read 472, codemode 769 tokens. codemode is 35% of all tool output with 175 calls; 11 results hit the 16 KB cut. Lower the codemode cut or make it return only what it needs.
- Edit rework is rare: 25 of 540 tasks with edits change one file 4 times or more.
