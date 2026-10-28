# Check live that pi emits message_end for pi.sendMessage

`bash` waits for `message_end` to know that a job report arrived. If pi does not send that event for `pi.sendMessage`, `bash` sends every report again after 20 s. Do a live test.

## Source

- zerodawn-pi main: docs/todo.md (Open points)

## Original text

- Check live that pi emits `message_end` for messages from `pi.sendMessage`. If not, `bash` resends every job report after 20 s of idle time (`tool/jobs.ts`, `unconfirmed`).
