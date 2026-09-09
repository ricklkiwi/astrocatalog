# AstroTracker — Agent Instructions

Instructions for coding agents working in this repository. Read this fully before starting any issue.

## Authoritative documents

1. **Design decisions** in `design/DD-001 … DD-008` are law. Read the DDs referenced by your issue before writing code. If your implementation must deviate, stop and propose a DD revision in the issue/PR discussion — never diverge silently.
2. `planning/task-breakdown.md` is the source of all issues; `planning/development-plan.md` defines milestones and working agreements.
3. The PRD (`planning/PRD-AstroTracker-v1.md`) is background context; where PRD and DDs conflict, DDs win.

## Agent harness policy

Agent prompts and model-routing policy are repo artifacts:

- `docs/agents/` contains the orchestrator/planner/spec-writer/coder/reviewer prompts and `MODEL_SELECTION.md`.
- `docs/adr/` records durable decisions about agent harness design and workflow.

When changing agent behavior, update the relevant prompt in `docs/agents/`. If the change affects model routing, orchestration workflow, safety policy, or harness design, add or update an ADR in `docs/adr/` in the same PR.

See `docs/agents/USAGE.md` for how to actually invoke these agents (and complementary Claude Code skills), in Claude Code or any other harness.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`ricklkiwi/astrocatalog`); skills use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five canonical triage labels as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); `wontfix` already exists on GitHub, the other four need creating. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo; domain knowledge lives in `design/DD-001`…`DD-008` and `docs/adr/` (no root `CONTEXT.md` — the DDs fill that role). See `docs/agents/domain.md`.

### Boundary with the `*.agent.md` pipeline

The skills and the five-agent pipeline share one issue tracker. They divide as follows (`ADR-005`):

- **Pipeline work is issues titled `[P<phase>-<nn>] …`**, created from `planning/task-breakdown.md`. The orchestrator claims only these, and gates only on the `Depends on:` line — it ignores triage labels entirely.
- **Skills may create issues; the pipeline may not.** `/qa`, `/to-issues`, `/to-prd`, and `/triage` file bugs and backlog items freely. The orchestrator creates issues only in its backfill step, or when you explicitly ask. A skill-created issue enters the pipeline only once a human retitles it `[P<phase>-<nn>]` and gives it a `Depends on:` line.
- **The two label vocabularies are independent.** Triage labels (`needs-triage`, `ready-for-agent`, …) drive the skills; `in-progress`, `backlog`, `phase:N`, `pkg:*`, and `type:*` drive the pipeline. Both may sit on one issue. `ready-for-agent` does **not** make an issue pipeline-eligible, and an unlabelled issue is not ineligible.

## Hard rules

- **Non-destructive guarantee:** no code path may modify, move, rename, or delete user image files. Only explicit user-invoked exports write outside the app-data directory. PRs violating this are rejected.
- **Layering (DD-002):** `packages/core` stays pure TypeScript — no Electron imports, no fs side effects in domain logic (parsers accept Buffers/streams). The renderer never touches fs/db/network directly; everything goes through the typed IPC contract.
- **Tests are part of done.** Every issue's acceptance criteria include tests; do not open a PR with failing or skipped acceptance tests. Core logic gets table-driven unit tests against `fixtures/`.
- **UUIDv7 primary keys and `updated_at` on every table** (DD-003) — required for Phase 2 sync.
- All timestamps stored UTC (DD-002 rule 4).

## Workflow

- One issue per PR; branch name `<issue-id>-short-slug` (e.g. `p1-01-fits-parser`).
- Conventional commits; squash merge.
- Complete the issue's acceptance criteria checklist in the PR description, with evidence (test names, benchmark output).
- If your issue has `Depends on:` entries that aren't merged yet, pick a different issue.
- CI (lint, typecheck, unit tests on ubuntu/windows/macos) must be green. CI runs
  `pnpm -r build && pnpm lint && pnpm test` — verify with those exact commands. `pnpm -r lint`
  skips the repo-wide `prettier --check .` and `pnpm -r test` skips the better-sqlite3 rebuild,
  so a green `-r` run does not mean a green CI.

## Commands (after P0-01 lands)

```
pnpm install        # bootstrap
pnpm -r build       # build all packages
pnpm lint           # lint:root (root configs + repo-wide prettier) THEN pnpm -r lint
pnpm test           # rebuilds better-sqlite3 (pretest), then root vitest over all projects
pnpm bench          # benchmarks (P0-07)
pnpm e2e            # playwright on packaged app (P0-08)
pnpm dev            # run desktop app with hot reload
```

## Conventions

- TypeScript strict; no `any` without a `// justified:` comment.
- Issue labels: `phase:N`, `pkg:core|db|desktop|cloud`, `type:feat|infra|test|docs`.
- Performance budgets (PRD §8.4) are enforced by CI benchmarks — treat regressions as build breaks.
