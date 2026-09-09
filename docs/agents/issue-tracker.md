# Issue tracker: GitHub

> Configures the Matt Pocock engineering skills (`to-issues`, `triage`, `to-prd`, `qa`, etc). Unrelated to the `*.agent.md` pipeline prompts elsewhere in this directory.

Issues and PRDs for this repo live as GitHub issues on `ricklkiwi/astrocatalog`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

This repo also has an existing label vocabulary from its own pipeline (`phase:N`, `pkg:core|db|desktop|cloud`, `type:feat|infra|test|docs`, `backlog`, `in-progress`) — these are separate from the triage labels in `docs/agents/triage-labels.md` and can be applied alongside them.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
