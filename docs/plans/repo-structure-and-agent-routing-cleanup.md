# Repository Structure And Agent Routing Cleanup Plan

**Status:** Completed
**Date:** 2026-07-12

## Goals

- Make `/Users/rickl/Documents/ai/AstrophotographyTracker/repo` the only project root that
  needs to be backed up and committed.
- Keep `docs/agents/MODEL_SELECTION.md` as the canonical model-routing policy for Claude, Codex,
  and any future agent harness.
- Remove drift between top-level working folders and the Git repository.
- Preserve the most current copy of every document before deleting or archiving duplicates.
- Leave a repeatable audit trail in commits.

## Completion Notes

Completed on 2026-07-12.

- Added `AGENTS.md` for Codex-style harnesses.
- Kept Sonnet as the Coder fallback in `docs/agents/MODEL_SELECTION.md` and
  `docs/adr/ADR-001-agent-harness-model-routing.md`.
- Moved the reusable GitHub bootstrap script and `.env.example` into the repo.
- Removed outer duplicate folders/files after confirming the repo copies were canonical.
- Left local-only `.env`, `.claude/`, `.pnpm-store/`, `repo/`, and `worktrees/` in place.

## Current Findings

The Git repository root is `repo/`, not the outer `AstrophotographyTracker/` folder.

Top-level duplicates currently exist outside Git:

| Outer folder | In-repo location | Status |
| --- | --- | --- |
| `agents/` | `repo/docs/agents/` | Same document set, but content drift exists. |
| `design/` | `repo/design/` | Byte-for-byte duplicate. |
| `planning/` | `repo/planning/` | Same major docs, but formatting/content drift exists. |
| `requirements/PRD-AstroTracker-v1.md` | `repo/planning/PRD-AstroTracker-v1.md` | PRD copy drift exists. |

Known model-routing drift:

- `agents/MODEL_SELECTION.md` routes Coder as `GPT-5.6 -> GPT-5.5 -> Opus -> GPT-5.4`.
- `repo/docs/agents/MODEL_SELECTION.md` routes Coder as
  `GPT-5.6 -> GPT-5.5 -> Sonnet -> GPT-5.4`.
- `repo/docs/adr/ADR-001-agent-harness-model-routing.md` currently agrees with the in-repo
  `Sonnet` route.

Known agent prompt drift:

- Outer `agents/*.agent.md` files still refer to `agents/MODEL_SELECTION.md`.
- In-repo `docs/agents/*.agent.md` files refer to `docs/agents/MODEL_SELECTION.md`.
- The in-repo paths are correct for a repo-owned harness policy.

Known planning/PRD drift:

- `repo/planning/development-plan.md`, `repo/planning/task-breakdown.md`, and
  `repo/planning/PRD-AstroTracker-v1.md` appear to be formatted/current repo copies.
- Outer planning and requirements copies appear older or outside the repo-owned structure.
- Before deletion, compare modification dates and semantic diffs one final time.

## Target Structure

Use this structure as the source of truth:

```text
repo/
  CLAUDE.md
  README.md
  CONTRIBUTING.md
  design/
    DD-001-tech-stack.md
    DD-002-application-architecture.md
    DD-003-database-schema.md
    DD-004-scanning-pipeline.md
    DD-005-target-resolution.md
    DD-006-sessions-and-calibration-matching.md
    DD-007-cloud-architecture.md
    DD-008-ux-structure.md
    README.md
  docs/
    adr/
      ADR-001-agent-harness-model-routing.md
    agents/
      MODEL_SELECTION.md
      orchestrator.agent.md
      planner.agent.md
      spec-writer.agent.md
      coder.agent.md
      reviewer.agent.md
    plans/
      repo-structure-and-agent-routing-cleanup.md
    specs/
  planning/
    PRD-AstroTracker-v1.md
    development-plan.md
    task-breakdown.md
```

Outer folders should not remain as editable project sources:

- Remove or archive outer `agents/`, `design/`, `planning/`, and `requirements/` after their
  contents have been reconciled into `repo/`.
- Keep `worktrees/` outside the canonical repo root as disposable Git worktrees unless there is
  a deliberate decision to preserve branch artifacts.

## Migration Plan

### 1. Freeze And Audit

- Confirm `repo/` is clean with `git status --short`.
- Generate a duplicate inventory with paths, modification times, sizes, and SHA-256 hashes.
- Compare these folder pairs:
  - `agents/` vs `repo/docs/agents/`
  - `design/` vs `repo/design/`
  - `planning/` vs `repo/planning/`
  - `requirements/PRD-AstroTracker-v1.md` vs `repo/planning/PRD-AstroTracker-v1.md`
- Save the audit output in a temporary file outside the repo or paste key findings into the PR.

### 2. Reconcile Canonical Documents

- Treat `repo/design/` as canonical because it is byte-for-byte identical to outer `design/`.
- Treat `repo/docs/agents/` as canonical for paths and harness integration.
- Decide the Coder fallback route explicitly:
  - If high-risk coding should fall back to Opus, update
    `repo/docs/agents/MODEL_SELECTION.md` and
    `repo/docs/adr/ADR-001-agent-harness-model-routing.md`.
  - If Claude-throughput compatibility should remain Sonnet, leave the current in-repo files.
- Treat `repo/planning/` as canonical unless a semantic diff shows outer files contain newer
  project decisions.
- If outer planning or PRD files contain unique current content, merge that content into the
  in-repo file instead of keeping parallel copies.

### 3. Add Harness Entry Points For Both Claude And Codex

- Keep `CLAUDE.md` as the Claude-facing root instruction file.
- Add `AGENTS.md` at repo root for Codex-style loaders if the harness expects it.
- In both files, point agents to:
  - `docs/agents/MODEL_SELECTION.md`
  - `docs/agents/*.agent.md`
  - `docs/adr/ADR-001-agent-harness-model-routing.md`
- Make `MODEL_SELECTION.md` vendor-neutral: role, task shape, escalation rules, and fallback
  model mapping should be clear even when a harness cannot use the exact listed model names.

### 4. Retire Outer Duplicates

- After the canonical files are committed, remove outer duplicate folders that are no longer
  needed:
  - `agents/`
  - `design/`
  - `planning/`
  - `requirements/`
- If any local tooling still expects the old paths, replace the folder with a short README or
  update the tooling to use `repo/` directly.
- Avoid symlinks unless a specific harness requires them; symlinks can confuse backup and
  portability behavior.

### 5. Commit In Small Checkpoints

Recommended commits:

1. `docs: add repository structure cleanup plan`
2. `docs: reconcile agent model routing policy`
3. `docs: add codex agent entrypoint`
4. `docs: reconcile planning documents`
5. `chore: remove duplicate outer project documents`

Each commit should include the relevant audit note in the commit message body when it removes or
replaces duplicate documents.

## Verification Checklist

- `git status --short` from `repo/` shows only intentional changes before each commit.
- `rg "agents/MODEL_SELECTION|requirements/PRD|\\.\\./planning" repo` finds no stale references.
- `diff -qr design repo/design` is clean before deleting outer `design/`.
- Any non-clean diffs for `agents`, `planning`, and `requirements` have been resolved or
  consciously rejected.
- `docs/agents/MODEL_SELECTION.md`, `.agent.md` frontmatter, `CLAUDE.md`, `AGENTS.md`, and
  `docs/adr/ADR-001-agent-harness-model-routing.md` agree on model-routing behavior.
- A final commit exists in `repo/` containing the cleanup plan and any reconciled files.

## Open Decisions

- Should Coder fallback prefer `Opus` for deeper reasoning or `Sonnet` for Claude-compatible
  coding throughput?
- Should outer `worktrees/` be kept as active development worktrees, archived, or pruned after
  their branches are merged?
- Should `repo/` be renamed or moved up one level later so the workspace root and Git root are
  the same directory?
