# ADR-002: `.claude/agents/*.md` Are Symlinks Into `docs/agents/`

**Status:** Accepted
**Date:** 2026-07-12

## Context

`ADR-001-agent-harness-model-routing.md` established `docs/agents/` as the canonical location for
agent prompts and model routing, with `.claude/agents/` implied to be a Claude-Code-specific
loading path. In practice, two independent copies were committed:
`docs/agents/<name>.agent.md` and `.claude/agents/<name>.md`. They drifted — the `.claude/agents/`
copies are missing the "Model Selection" sections added later to `docs/agents/`. Claude Code loads
subagents from `.claude/agents/`, so it was silently running the out-of-date prompts.

The prior `docs/plans/repo-structure-and-agent-routing-cleanup.md` recommended avoiding symlinks
"unless a specific harness requires them." Claude Code's subagent loader requires files at
`.claude/agents/*.md` with no way to redirect it via configuration — this is that specific case.

## Decision

`.claude/agents/*.md` are replaced with symlinks to `docs/agents/*.agent.md`. There is exactly one
editable copy of every agent prompt (`docs/agents/*.agent.md`); `.claude/agents/` exists only to
satisfy Claude Code's fixed loading path.

This does not change anything else `ADR-001` decided: `docs/agents/MODEL_SELECTION.md` remains the
model-routing policy, and the `model:`/`tools:` frontmatter in each `.agent.md` remains a
Claude-Code-compatibility fallback, not the source of truth.

## Consequences

- Editing any agent's behavior means editing exactly one file:
  `docs/agents/<name>.agent.md`. There is no second copy to remember to update.
- `git status`/`git diff` on `.claude/agents/` will show symlink mode changes (`120000`) rather
  than content; reviewers should expect this and look at `docs/agents/` for the actual prompt diff.
- On a machine or CI runner that checks out git symlinks as literal text files (most commonly
  Windows without `core.symlinks` / Developer Mode enabled), `.claude/agents/*.md` would contain
  the link-target path string instead of real prompt content, and Claude Code would treat that
  string as the subagent's system prompt. Nothing in this repo's CI pipeline reads
  `.claude/agents/`, so this has no build/test impact; it only matters if someone runs Claude Code
  itself from such a checkout. If that becomes a real scenario, revisit with a generated-copy +
  drift-check script instead (rejected for now — see the companion plan doc for why).
- A different agent harness (Codex-style or otherwise) does not need this redirect at all — it has
  no equivalent fixed subagent directory and already reads `docs/agents/` directly via `AGENTS.md`.

## Update Rule

Unchanged from `ADR-001`: any change to agent behavior is made in `docs/agents/`. Do not add
content directly under `.claude/agents/` — it is a symlink target, not a source file, and edits
made there risk breaking the symlink or being silently lost.
