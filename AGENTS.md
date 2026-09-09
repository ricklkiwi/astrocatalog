# AstroTracker Agent Instructions

This repository supports both Claude-style and Codex-style agent harnesses. `CLAUDE.md` is the
authoritative root instruction file for coding agents; read it before starting any issue.

## Agent Harness Policy

Agent prompts and model-routing policy are repo artifacts:

- `docs/agents/` contains the orchestrator, planner, spec-writer, coder, reviewer prompts, and
  `MODEL_SELECTION.md`.
- `docs/agents/MODEL_SELECTION.md` is the canonical model-routing policy for any harness that
  can choose models explicitly.
- `docs/adr/` records the durable decisions behind the harness. `ADR-001` covers model routing,
  `ADR-002` the `.claude/agents/` symlink redirect, `ADR-003` the frontmatter mechanics, and
  `ADR-005` the boundary between this pipeline and the general-purpose agent skills.

Per-role model preferences live in `docs/agents/MODEL_SELECTION.md` only — do not copy them here,
or into an agent prompt. That file is the single source of truth, and it carries a live table of
what each agent's frontmatter currently says.

**In Claude Code, the `model:` line in each `.agent.md` frontmatter is the routing mechanism, not
a fallback** (`ADR-003`) — a running agent cannot change its own model. In a harness that routes
dynamically, read the preference lists in `MODEL_SELECTION.md` instead and request the
role-appropriate model yourself.

See `docs/agents/USAGE.md` for how to invoke each agent's role and pipeline order in a harness
without a fixed subagent-loading directory.

## Agent Skills

Separately from the five pipeline agents above, this repo is configured for the general-purpose
Matt Pocock engineering skills. Their configuration lives in `docs/agents/`, and `CLAUDE.md`'s
`## Agent skills` section is the authoritative copy:

- `docs/agents/issue-tracker.md` — issues live in GitHub (`ricklkiwi/astrocatalog`), driven by `gh`
- `docs/agents/triage-labels.md` — the five canonical triage labels
- `docs/agents/domain.md` — how skills should read `design/DD-*` and `docs/adr/` (this repo has no
  root `CONTEXT.md`; the DDs fill that role)

These files configure the skills, not the `*.agent.md` pipeline prompts. `ADR-005` records where
the two systems' responsibilities divide.

## Update Rule

When changing agent behavior, update the relevant prompt in `docs/agents/`. If the change affects
model routing, orchestration workflow, safety policy, or harness design, update or add an ADR in
`docs/adr/` in the same change.
