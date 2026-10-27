# bash

Replaces pi's `bash` tool. Every command runs as a job without a terminal, like in CI: stdout and stderr go to a log file, stdin is `/dev/null`. A pager, editor or prompt fails at once instead of waiting. `FORCE_COLOR` and `CLICOLOR_FORCE` keep the colors of tools that obey them. The tool waits at most 15 s for the command and streams the last 40 lines while it runs. A command that runs longer continues as a background job and ends the turn (`terminate`), so the user can chat; the message of the job starts the next turn.

## Tools

`bash` — `command`, `timeout` (seconds, default 3600; `# no-time-limit` in the command removes it), `background`, `group`.

- Result: the exit status. Output of at most 50 lines and 4 KB comes with it; longer output gives its size and path, and the agent reads the file with `read`. This is the same for a success and a failure. A failure with longer output adds every distinct error line with its line numbers, from the whole log, or the last 3 lines when there is none.
- A working directory that does not exist (for example a removed worktree) fails before the command starts, with its path.
- A command that ends within 15 s returns its output inline. A longer command returns the job id and ends the turn. `background: true` (a server) returns the job id at once and keeps the turn. The result comes as a `bash-job` message, or through `jobs wait`. Jobs with the same `group` report together.
- A report that pi did not record is sent again after 20 s of idle time.
- A user prompt gets one hidden line `jobs: 3: running · 4 [g]: exit 0` with the jobs that run or ended without a report in the context, only when it changed since the last line.

`jobs` — `wait` (block until jobs end, at most 600 s), `list`, `kill`. `list` fails when nothing changed since the last call, to stop polling.

## Guard

A bash command that only waits (`sleep`, `wait`, `true`, `:`) is blocked. The reason gives the chain form `timeout 30 bash -c 'until CHECK; do sleep 1; done' && NEXT`, or, while a job runs, says that a message reports it.

## Keys and commands

| Key | What |
|---|---|
| `ctrl+shift+b` | move the running foreground commands to the background |
| `alt+h` | expand or collapse the tools dashboard above the editor |
| `ctrl+shift+j` | follow a job in the chat; again to close |
| `/jobs` | same as `ctrl+shift+j`; `/jobs list`, `/jobs show <id>`, `/jobs kill <id>` |

The dashboard shows every tool call of the turn with status, elapsed time and the last 3 output lines of a running bash job. Click a row to follow that job.

## Files

Logs and job state live next to the session file: `<session>/out/<id>.bash.log` (raw output), `<id>.bash.txt` (clean text, only when the inline result was cut), `<session>/jobs/<id>.{sh,json,status}`. The id is `<turn>.<round>-C<n>`.

Jobs survive a pi restart: `session_start` reads the job files, reports jobs that ended, and polls jobs that still run.

## Check findings

`just check-findings [since]` reads the pi sessions since a date (default: 7 days ago) and shows check results that did not help the agent: the agent read the check log, ran the same linter again with a pipe, or ran a linter that got the normal bash result. It also shows the `check-anomalies.jsonl` of the tests extension. Code: `tool/findings.ts`. Make a fixture in `shared/fixtures/check/` from each new case.

## Layout

`tool/` the `bash` and `jobs` tools, the guard and the job process; `ui/` dashboard, follow view, transcript rendering, icons; `screen/` the screen model that turns raw output with escapes into lines.

## Constants

`config.ts`: stream interval and lines, inline limits, head and error line limits, default time limit, dashboard rows.

## Changes

<!-- changelog:start -->
## 0.6.0 — 2026-10-27

- files: read sends only new lines; bash blocks file views

[All changes](CHANGELOG.md)
<!-- changelog:end -->
