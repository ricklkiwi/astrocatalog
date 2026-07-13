# ADR-001: Agent Harness And Model Routing Are Repo Artifacts

**Status:** Accepted
**Date:** 2026-07-12

## Context

AstroTracker uses multiple specialist agents: orchestrator, planner, spec writer, coder, and
reviewer. Early versions of these prompts lived outside the git repo and assumed a
Claude/Anthropic-style harness with `sonnet` and `opus` model aliases.

That made important operating decisions fragile:

- Model routing existed in chat or local files rather than in source control.
- A different harness could run the wrong model for a role.
- Future agents could not see why a role should prefer one model family over another.
- Agent workflow changes were easy to lose when the repo moved to another machine or agent
  runtime.

## Decision

Agent harness design is part of the project and must be captured alongside repo code.

The canonical in-repo locations are:

- `docs/agents/` for executable agent prompts and `MODEL_SELECTION.md`.
- `docs/adr/` for durable decisions explaining why the harness and model-routing policy work the
  way they do.
- `CLAUDE.md` for the short rule that future agents must keep these artifacts updated.

Harnesses that support explicit model selection should use `docs/agents/MODEL_SELECTION.md`.
The `model:` field in each `.agent.md` remains a compatibility fallback for Claude-style loaders
that accept only simple aliases.

Current role routing:

| Role         | Preferred models                        |
| ------------ | --------------------------------------- |
| Orchestrator | Fable 5 -> GPT-5.6 -> GPT-5.5 -> Opus   |
| Planner      | Fable 5 -> GPT-5.6 -> GPT-5.5 -> Opus   |
| Spec Writer  | Opus -> GPT-5.4 -> Sonnet               |
| Coder        | GPT-5.6 -> GPT-5.5 -> Sonnet -> GPT-5.4 |
| Reviewer     | GPT-5.5 -> Opus -> Sonnet               |

## Consequences

- Agent behavior and model-routing choices travel with the codebase.
- Prompt changes are reviewable in PRs like application code.
- Harness-specific frontmatter can stay compatible without hiding the preferred routing policy.
- When a model or harness choice changes, the prompt/policy change and its reason are captured
  together.

## Update Rule

Any PR that changes agent behavior must update `docs/agents/`.

Any PR that changes model routing, orchestration workflow, safety policy, or harness design must
also update or add an ADR in `docs/adr/`.
