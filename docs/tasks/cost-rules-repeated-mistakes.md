# Put repeated mistakes as ast-grep or semgrep rules in the repo

A mistake that comes back must become a rule. Run it after each edit and in `just check`: ast-grep for code, semgrep for security and IaC.

## Source

- zerodawn-pi branch todo-cost-analysis (PR #119): TODO.md

## Original text

- Rules for repeated mistakes: semgrep and ast-grep are installed; agents ran semgrep about 30 times by hand, ast-grep 31 times. zerodawn-pi has no rule files (other repositories not checked). Put a mistake that comes back as a rule in the repository and run it after each edit and in `just check`: ast-grep for code, semgrep for security and IaC (taint, Terraform, Dockerfile, Kubernetes).
