# ADR-005: The Agent Pipeline And The General-Purpose Skills Share One Tracker, Not One Workflow

**Status:** Accepted
**Date:** 2026-09-07

> Numbered 005 because `ADR-004-schema-rollout-deviation.md` is already taken on the unmerged
> `chore/drop-processing-project-tables` branch.

## Context

This repo now runs two independent agent systems against the same GitHub tracker:

1. **The five-agent pipeline** (`docs/agents/*.agent.md`) — orchestrator → planner → spec-writer →
   coder → reviewer, driving issues pre-created from `planning/task-breakdown.md` and titled
   `[P<phase>-<nn>] …`, gated on each issue's `Depends on:` line, and using the labels
   `in-progress`, `backlog`, `phase:N`, `pkg:*`, `type:*`.
2. **The general-purpose agent skills**, configured by `docs/agents/issue-tracker.md`,
   `docs/agents/triage-labels.md`, and `docs/agents/domain.md`, and pointed at from `CLAUDE.md`'s
   `## Agent skills` section. These use the five canonical triage labels (`needs-triage`,
   `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) and include skills whose entire
   purpose is to create issues (`/qa`, `/to-issues`, `/to-prd`) and to move them through a triage
   state machine (`/triage`).

Nothing had been written down about how they relate, which left three live ambiguities:

- **Issue creation.** The orchestrator's prompt says "Do NOT create new feature issues — the
  backlog is the plan." Three installed skills exist specifically to create issues. Left
  unstated, `/qa` filing five bug reports produces issues the orchestrator has no rule for.
- **Eligibility.** With `ready-for-agent` now a real label on this tracker, it reads as though it
  ought to gate pipeline work. It was never wired to anything, so an issue could appear ready to a
  human and be invisible to the orchestrator, or vice versa.
- **Review.** The `/review` skill checks changes since a fixed point along Standards and Spec
  axes — substantially the `reviewer` agent's job, but with no blocking authority and without the
  invariant deep-check the `reviewer` performs on every task.

At the time of writing, 16 of the 47 open issues are not `[P…]`-titled — bugs and backlog items
that the orchestrator's candidate query was silently including.

## Decision

**One tracker, two workflows, with the title as the discriminator.**

- **Pipeline work is exactly the issues titled `[P<phase>-<nn>] …`.** The orchestrator's candidate
  query filters on that prefix, and eligibility remains gated on `Depends on:` alone.
- **The orchestrator ignores triage labels entirely.** `ready-for-agent` does not make an issue
  claimable; the absence of a triage label does not block one. Adding a second gate would create a
  way for work to become silently ineligible, and the dependency graph is the real constraint.
- **Skills create issues; the pipeline does not.** `/qa`, `/to-issues`, `/to-prd`, and `/triage`
  file bugs and backlog items freely. The orchestrator creates issues only in its backfill step or
  on explicit instruction. A skills-filed issue enters the pipeline only when a **human** retitles
  it `[P<phase>-<nn>]` and gives it a `Depends on:` line — the orchestrator must surface the
  candidate and stop rather than promote it itself.
- **The two label vocabularies are independent and may coexist on one issue.**
- **`/review` does not substitute for the `reviewer` agent.** The `reviewer` is the blocking
  in-pipeline gate: it runs against `docs/specs/<slug>.md`, may write tests, runs the suite and
  benchmarks, performs the invariant deep-check, and returns PASS/FAIL. Step 5 cannot be delegated
  to a skill. `/review` is an out-of-pipeline second opinion, useful on work that never went
  through the pipeline or as an extra pass before the `reviewer`.

## Consequences

- The orchestrator's candidate pool drops from every open unlabelled issue to the 31 that are
  actually pipeline tasks — the 16 bug/backlog issues are no longer offered to it.
- Promotion from "bug someone filed" to "pipeline task" is a deliberate human act, which keeps
  `planning/task-breakdown.md` the source of the plan rather than letting the backlog grow itself.
- Triage state and pipeline state can disagree without either being wrong. An issue can be
  `ready-for-agent` and not pipeline-eligible; that is expected, not a bug to reconcile.
- Two reviews may run on the same change. That is accepted: only one of them can block.
- If the triage labels are ever wanted as a pipeline gate, that is a change to this ADR and to the
  orchestrator's Step 0 together — not a label convention someone adopts informally.

## Update Rule

`ADR-001`'s update rule stands. Any change to which issues the pipeline will claim, or to which
system owns issue creation, must update this ADR and `docs/agents/orchestrator.agent.md` in the
same change.
