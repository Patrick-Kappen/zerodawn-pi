# Remove the duplicate package entries in ~/.pi/agent/settings.json

Both packages are in the settings twice, once with a filter and once without. Pi then loads extensions twice or ignores the filter. Keep one entry per package.

## Source

- zerodawn-pi main: TODO.md

## Original text

- `~/.pi/agent/settings.json` lists both packages twice: once with a filter, once without. Clean it up.
