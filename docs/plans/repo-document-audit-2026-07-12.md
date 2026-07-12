# Repository Document Audit

**Date:** 2026-07-12

## Scope

Audited project documents that existed outside the Git repository root at
`/Users/rickl/Documents/ai/AstrophotographyTracker/repo`.

## Findings

| Outer path | Canonical repo path | Decision |
| --- | --- | --- |
| `agents/` | `repo/docs/agents/` | Use repo copy. Repo paths are correct and Coder fallback remains Sonnet. |
| `design/` | `repo/design/` | Use repo copy. Files are byte-for-byte identical. |
| `planning/` | `repo/planning/` | Use repo copy. Repo files are newer formatted copies. |
| `requirements/PRD-AstroTracker-v1.md` | `repo/planning/PRD-AstroTracker-v1.md` | Use repo copy. Repo PRD is newer formatted copy. |
| `bootstrap-github.py` | `repo/scripts/bootstrap-github.py` | Move into repo and update paths to run from repo root. |
| `.env.example` | `repo/.env.example` | Move into repo as the committed environment template. |
| `.env copy.example` | `repo/.env.example` | Duplicate of `.env.example`; do not preserve separately. |
| `.env` | None | Real local secrets file; leave uncommitted and outside cleanup commits. |
| outer `CLAUDE.md` | `repo/CLAUDE.md` | Outer file is obsolete one-line note; use repo copy. |
| `development/` | None | Empty outer folder. |
| `research/` | None | Empty outer folder. |
| `spec/` | None | Empty outer folder. |

## Model Routing Decision

The repo-owned model-routing policy remains:

```text
Coder: GPT-5.6 -> GPT-5.5 -> Sonnet -> GPT-5.4
```

This matches `docs/agents/MODEL_SELECTION.md` and
`docs/adr/ADR-001-agent-harness-model-routing.md`.

## Cleanup Decision

After this audit is committed, the outer duplicate document folders can be removed so future work
only happens in the Git repository.
