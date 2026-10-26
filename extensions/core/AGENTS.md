# core

- Write `settings.json` only in the format of `pi config`.
- Change only the toggled entry.
- `/ext` never disables itself.

## After a pi upgrade

- Run `pi config`. Compare what it writes with the description at the top of `lib/settings.ts`. Update the code and the description when it changed.
