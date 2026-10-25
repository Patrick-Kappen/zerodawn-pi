# core

The `/ext` command: toggles extensions, skills, prompts and themes by writing `settings.json` in the format `pi config` uses. `lib/settings.ts` starts with a description of that format; update it when pi changes it. It never disables itself, and it only edits the toggled entry.
