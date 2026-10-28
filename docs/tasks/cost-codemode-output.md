# Decrease codemode output

codemode gives 35% of all tool output. Lower its cut, or make it return only what is needed.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Tool output: median per result bash 42, edit 237, grep 338, read 472, codemode 769 tokens. codemode is 35% of all tool output with 175 calls; 11 results hit the 16 KB cut. Lower the codemode cut or make it return only what it needs.
