# Improvements:

- I think file editting could be done cheaper and better.
- Force read -> Multi edit, things like that.
- The view guard blocks rg or grep in a loop whose output goes to a file (`for x in ...; do rg ... "$x"; done > file`).
- The formatter uses a biome.json that it finds above a file outside a repository (for example in /tmp), and then fails on the plugins.
