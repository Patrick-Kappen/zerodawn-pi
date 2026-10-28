# Decrease the number of calls per task

Each call sends the context again and takes about 5 s. 9.3 calls per prompt is the next lever. Let the agent do small steps with little output, maybe driven by the SDK.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Next lever is calls per task: 9.3 calls per user prompt after 2026-10-27, bash is half of the tool calls. Let the agent do small steps with little output between them, maybe driven by the SDK.
- Speed: model time 59%, tool time 41%. A model call takes 4.5 s median, plus 1.6 s per 100 output tokens. One call less saves about 5 s.
- Output: 3.8k tokens per task, 32% reasoning. New context per task 18.8k, of which tool output 3.8k.
