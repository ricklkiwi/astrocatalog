# AstroTracker Agent Instructions

This repository supports both Claude-style and Codex-style agent harnesses. `CLAUDE.md` is the
authoritative root instruction file for coding agents; read it before starting any issue.

## Agent Harness Policy

Agent prompts and model-routing policy are repo artifacts:

- `docs/agents/` contains the orchestrator, planner, spec-writer, coder, reviewer prompts, and
  `MODEL_SELECTION.md`.
- `docs/agents/MODEL_SELECTION.md` is the canonical model-routing policy for any harness that
  can choose models explicitly.
- `docs/adr/ADR-001-agent-harness-model-routing.md` records the durable decision behind the
  harness and model-routing structure.

For Coder routing, use the current repo policy:

```text
GPT-5.6 -> GPT-5.5 -> Sonnet -> GPT-5.4
```

The `model:` value in each `.agent.md` frontmatter is only a compatibility fallback for loaders
that require simple Claude aliases.

## Update Rule

When changing agent behavior, update the relevant prompt in `docs/agents/`. If the change affects
model routing, orchestration workflow, safety policy, or harness design, update or add an ADR in
`docs/adr/` in the same change.
