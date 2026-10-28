# Stop the formatter from using a biome.json above a file outside a repo

For a file in /tmp, the formatter finds a random biome.json higher up and fails on its plugins. Limit the search to the repository.

## Source

- zerodawn-pi main: extensions/files/TODO.md

## Original text

- The formatter uses a biome.json that it finds above a file outside a repository (for example in /tmp), and then fails on the plugins.
