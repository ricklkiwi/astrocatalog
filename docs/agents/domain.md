# Domain Docs

> Configures the Matt Pocock engineering skills (`improve-codebase-architecture`, `diagnose`, `tdd`, etc). Unrelated to the `*.agent.md` pipeline prompts elsewhere in this directory.

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo has no root `CONTEXT.md`. Its domain/architecture source of truth is the design decision docs, which `CLAUDE.md` calls "law":

## Before exploring, read these

- **`design/DD-001-tech-stack.md`** through **`design/DD-008-ux-structure.md`** — read the DDs relevant to the area you're about to work in. In place of a `CONTEXT.md`, these define the domain vocabulary and architecture decisions.
- **`planning/PRD-AstroTracker-v1.md`** — background context only; where the PRD and DDs conflict, DDs win (per `CLAUDE.md`).
- **`planning/task-breakdown.md`** and **`planning/development-plan.md`** — source of issues and milestones, useful for understanding scope and sequencing.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in (currently `ADR-001-agent-harness-model-routing.md`, `ADR-002-claude-agents-symlink-redirect.md`).

This is a single-context repo: one set of DDs plus one `docs/adr/` at the root. No `CONTEXT-MAP.md`, no per-package `CONTEXT.md`.

If any of these files don't exist, proceed silently — don't flag their absence.

## Use the DDs' vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant DD. Don't drift to synonyms the DDs avoid.

If the concept you need isn't covered in any DD, that's a signal — either you're inventing language the project doesn't use (reconsider), or there's a real gap worth raising.

## Flag DD/ADR conflicts

If your output contradicts an existing DD or ADR, surface it explicitly rather than silently overriding — and per `CLAUDE.md`'s hard rule, propose a DD revision in the issue/PR discussion rather than diverging silently:

> _Contradicts DD-004 (scanning pipeline) — but worth reopening because…_
