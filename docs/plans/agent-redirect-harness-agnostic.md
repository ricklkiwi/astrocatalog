# .claude/agents Redirect And Harness-Agnostic Agent Cleanup Plan

**Status:** Completed
**Date:** 2026-07-12

## Problem

`docs/agents/*.agent.md` is meant to be the canonical, harness-agnostic source for the five
project agents (orchestrator, planner, spec-writer, coder, reviewer). `.claude/agents/*.md` is a
second, separately-committed copy that Claude Code actually loads when it scans for project
subagents.

These two sets of files have already drifted. Diffing `orchestrator.md` against
`orchestrator.agent.md` shows `.claude/agents/orchestrator.md` is missing the entire "Model
Selection" section and every "Preferred model: ..." line. The same shape of drift is likely across
all five pairs. Concretely: **Claude Code is currently running an out-of-date, less
harness-aware version of every agent**, because it reads `.claude/agents/`, not `docs/agents/`.

This repeats the exact failure mode `docs/adr/ADR-001-agent-harness-model-routing.md` was written
to prevent — agent behavior living in two places that can silently disagree.

## Goals

1. `docs/agents/*.agent.md` becomes the _only_ place agent prompt content is edited.
2. `.claude/agents/*.md` still exists (Claude Code requires files at that exact path) but can
   never drift, because it is not an independent copy.
3. Agent prompts stay usable by any harness (Claude Code, Codex-style, others), not just Claude.
4. A guide exists explaining how to actually invoke these agents and which Claude Code skills
   complement them.

## Decision: Symlinks, Not Generated Copies

`docs/plans/repo-structure-and-agent-routing-cleanup.md` previously recommended avoiding symlinks
"unless a specific harness requires them." This is that case: Claude Code's subagent loader reads
literal files from `.claude/agents/*.md` — there is no config to point it elsewhere. A symlink is
the smallest mechanism that makes drift structurally impossible instead of policing it after the
fact.

Chosen over a generated-copy + drift-check script because:

- Zero moving parts — no script to remember to run, no pre-commit hook that can be skipped with
  `--no-verify`.
- This is a single-developer repo on macOS (Darwin); symlink support is a non-issue for the
  primary dev machine.
- Nothing in the CI pipeline (`docs/archive/tasks/p0-02-ci-pipeline/spec.md`) reads `.claude/agents/`, so a
  Windows CI runner resolving the symlink incorrectly has no build/test impact. It would only
  matter if someone runs Claude Code itself from a Windows checkout — noted as a follow-up risk
  below, not a blocker.

## Migration Steps

### 1. Confirm the full extent of drift

Before overwriting anything, diff all five pairs (not just orchestrator) and note any content in
the `.claude/agents/` copies that does _not_ exist in `docs/agents/` — that would be lost content
that needs to be merged into the canonical file first, not discarded.

```bash
cd repo
for f in orchestrator planner spec-writer coder reviewer; do
  echo "=== $f ==="
  diff ".claude/agents/$f.md" "docs/agents/$f.agent.md"
done
```

**Actual result (checked 2026-07-12):** all five pairs confirm the same pattern —
`docs/agents/*.agent.md` is a strict superset, adding the "Model Selection" section and
"Preferred model: ..." lines, plus incidental whitespace/formatting differences (extra spacing in
metadata lines, blank-line placement). Nothing exists only in `.claude/agents/` that would be lost.

One finding is a real behavior change, not just added prose: the `model:` frontmatter itself
differs for two roles, and it's swapped, not just stale:

| Role          | `.claude/agents/*.md` (what Claude Code runs today) | `docs/agents/*.agent.md` (canonical, matches ADR-001's routing table) |
| ------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `spec-writer` | `model: sonnet`                                     | `model: opus`                                                         |
| `reviewer`    | `model: opus`                                       | `model: sonnet`                                                       |

Executing this redirect will flip which Claude model each of those two subagents defaults to.
This is the _correct_ direction per `docs/adr/ADR-001-agent-harness-model-routing.md`'s own
routing table (Spec Writer: Opus → GPT-5.4 → Sonnet; Reviewer: GPT-5.5 → Opus → Sonnet, with
`sonnet` as its Claude-only fallback) — but call it out explicitly before executing, since it's a
behavior change, not just a documentation sync.

### 2. Replace `.claude/agents/*.md` with symlinks

```bash
cd repo/.claude/agents
for f in orchestrator planner spec-writer coder reviewer; do
  git rm "$f.md"
  ln -s "../../docs/agents/$f.agent.md" "$f.md"
  git add "$f.md"
done
```

Note the filename mismatch is intentional and harmless: the symlink is named `coder.md` (so
Claude Code's `.claude/agents/*.md` scan finds it), but it points at `coder.agent.md`. Claude Code
reads file _contents_ through the symlink; the target's own extension is irrelevant.

### 3. Verify Claude Code actually loads the redirected content correctly

This is the step most likely to surface a real incompatibility, not just a process detail — do
not skip it:

- Run `/agents` (or equivalent) in Claude Code and confirm all five agents are listed with the
  descriptions from `docs/agents/*.agent.md`.
- Invoke one agent (e.g. spawn the `coder` subagent on a trivial task) and confirm its behavior
  reflects the "Model Selection" section content, and that its actual tool access matches the
  `tools:` frontmatter line.
- Specifically check the `tools: [Read, Edit, Write, Bash]` bracket syntax parses into the same
  restricted tool set as the pre-redirect files did. If Claude Code's frontmatter parser expects
  an unbracketed comma list (`tools: Read, Edit, Write, Bash`) and treats the bracketed form as a
  literal string, tool restrictions would silently break. If so, drop the brackets in
  `docs/agents/*.agent.md` (this is a one-line-per-file fix, not a redesign).

### 4. Record the decision

Add `docs/adr/ADR-002-claude-agents-symlink-redirect.md` (see companion file) capturing why
symlinks were chosen here specifically, superseding the general "avoid symlinks" guidance from the
prior cleanup for this one case.

### 5. Add the usage guide

Add `docs/agents/USAGE.md` (see companion file) documenting how to invoke each project agent and
how Claude Code's built-in skills relate to them.

### 6. Update entry-point docs

- `CLAUDE.md` and `AGENTS.md`: add one line pointing at `docs/agents/USAGE.md` for "how do I
  actually run this."
- No change needed to the "Update Rule" in `ADR-001` — it already says update
  `docs/agents/`, which remains true and is now the _only_ place to update.

## Harness-Agnosticism: What's Already Solved vs. What's Still Claude-Specific

Already solved by the existing `MODEL_SELECTION.md` / `ADR-001` design:

- Model choice per role, with explicit fallback chains for non-Claude harnesses.

Still Claude-Code-specific, and worth naming rather than silently accepting:

- The `tools:` frontmatter line uses Claude Code's tool identifiers (`Read`, `Edit`, `Write`,
  `Bash`, `Agent`, `WebFetch`, `WebSearch`). A different harness has different tool names and
  cannot parse this field directly. Today the prose body of each `.agent.md` already describes
  each role's job in harness-neutral language, which is enough for a human or another harness's
  operator to reconstruct equivalent tool grants by hand — but there is no explicit "capabilities
  needed" line separate from Claude's `tools:` syntax. Treat this the same way `model:` is already
  treated: a Claude-compatibility fallback, not the source of truth. Not fixing this now — flagged
  as an open decision below.
- The orchestrator's delegation mechanism (`tools: [Agent, ...]`) assumes a harness with a
  Task/subagent-spawning tool. A harness without that concept (e.g. a plain chat-based Codex
  session) can't literally follow "delegate via the Agent tool" — a human or the harness's own
  orchestration would need to run planner → spec-writer → coder → reviewer sequentially by hand,
  in the same order, using the same prompts. This is already implicitly true from reading the
  prose; it just isn't stated as a fallback instruction the way model routing is.

## Verification Checklist

- `for f in orchestrator planner spec-writer coder reviewer; do diff .claude/agents/$f.md docs/agents/$f.agent.md; done`
  produces no output (validated 2026-07-18).
- `.claude/agents/*.md` are filesystem symlinks pointing into `docs/agents/`; the worktree shows
  the expected type changes for those five paths.
- `docs/adr/ADR-002-claude-agents-symlink-redirect.md` and `docs/agents/USAGE.md` exist and are
  linked from `CLAUDE.md` / `AGENTS.md` (validated 2026-07-18).
- `/agents` in Claude Code should list all five with current descriptions. This is a
  Claude-Code-runtime check and cannot be executed from a Codex-only session.
- A live invocation of at least one agent should confirm tool restrictions still apply as expected.
  This is also a Claude-Code-runtime check and remains manual.

## Open Decisions

- Should each `.agent.md` gain an explicit harness-neutral "Capabilities" line (read/edit/write
  files, run shell, spawn sub-tasks) alongside the Claude-specific `tools:` frontmatter, the same
  way `MODEL_SELECTION.md` exists alongside the Claude-specific `model:` field? Not done in this
  pass; worth a follow-up if a second harness (Codex or otherwise) is actually put into regular
  use against this repo.
- Should there be a lightweight guard (e.g. a `pnpm` script or CI step) that fails loudly if
  `.claude/agents/*.md` are ever plain files again instead of symlinks, to catch the case where a
  future edit "helpfully" recreates a real file? Left as a follow-up, not required for this pass.
