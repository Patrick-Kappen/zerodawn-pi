# bash

Replaces pi's `bash` tool. Every command runs as a job in a PTY under `script`, so the output keeps colors and progress lines. The tool waits for the command and streams the last 40 lines while it runs.

## Tools

`bash` — `command`, `timeout` (seconds, default 3600; `# no-time-limit` in the command removes it), `background`, `group`.

- Inline result: up to 2000 lines or 16 KB. Longer output returns the first 20 lines, lines that look like errors, the last lines, and the path of the full output.
- `background: true` returns the job id at once. The result comes as a `bash-job` message, or through `jobs wait`. Jobs with the same `group` report together.
- A report that pi did not record is sent again after 20 s of idle time.

`jobs` — `wait` (block until jobs end, at most 600 s), `list`, `kill`. `list` fails when nothing changed since the last call, to stop polling.

## Guard

While a background job runs, a bash command that only waits (`sleep`, `wait`, `true`, `:`) is blocked.

## Keys and commands

| Key | What |
|---|---|
| `ctrl+shift+b` | move the running foreground commands to the background |
| `alt+h` | expand or collapse the tools dashboard above the editor |
| `ctrl+shift+j` | follow a job in the chat; again to close |
| `/jobs` | same as `ctrl+shift+j`; `/jobs list`, `/jobs show <id>`, `/jobs kill <id>` |

The dashboard shows every tool call of the turn with status, elapsed time and the last 3 output lines of a running bash job. Click a row to follow that job.

## Files

Logs and job state live next to the session file: `<session>/out/<id>.bash.log` (raw PTY), `<id>.bash.txt` (clean text, only when the inline result was cut), `<session>/jobs/<id>.{sh,json,status}`. The id is `<turn>.<round>-C<n>`.

Jobs survive a pi restart: `session_start` reads the job files, reports jobs that ended, and polls jobs that still run.

## Layout

`tool/` the `bash` and `jobs` tools, the guard and the job process; `ui/` dashboard, follow view, transcript rendering, icons; `screen/` the terminal screen model with PTY fixtures.

## Constants

`config.ts`: stream interval and lines, inline limits, head and error line limits, default time limit, dashboard rows.

## Changes

<!-- changelog:start -->
No release yet.

[All changes](CHANGELOG.md)
<!-- changelog:end -->
