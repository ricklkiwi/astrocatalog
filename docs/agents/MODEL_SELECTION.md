# AstroTracker Agent Model Selection

Use this file as the model-routing policy for harnesses that can choose between OpenAI,
Anthropic, and other model families. The `model:` value in each `.agent.md` frontmatter is a
compatibility fallback for Claude-style loaders; when the harness supports explicit model
selection, prefer the role-specific lists below.

## General Rules

- Pick by task shape, not vendor.
- Prefer the first available model in the role's list.
- Escalate to a stronger model when the task has high ambiguity, cross-package architecture,
  security/data-safety risk, migrations, native packaging, or repeated failed attempts.
- Use a cheaper/faster model only for mechanical edits, formatting, simple docs, or isolated
  one-file changes.
- Never let model choice weaken the repo rules in `CLAUDE.md` or the design decisions in
  `design/DD-001...DD-008`.

## Role Defaults

| Role         | Preferred models                        | Use when                                                                            |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------------- |
| Orchestrator | Fable 5 -> GPT-5.6 -> GPT-5.5 -> Opus   | Issue triage, dependency checks, pipeline control, PR creation, cross-agent handoff |
| Planner      | Fable 5 -> GPT-5.6 -> GPT-5.5 -> Opus   | Deep repo/design research, ambiguous scope, sequencing, risk identification         |
| Spec Writer  | Opus -> GPT-5.4 -> Sonnet               | Turning plan and issue acceptance criteria into precise, verifiable criteria        |
| Coder        | GPT-5.6 -> GPT-5.5 -> Sonnet -> GPT-5.4 | Implementation, refactors, migrations, frontend/Electron work, test repair          |
| Reviewer     | GPT-5.5 -> Opus -> Sonnet               | Spec conformance, bug/risk review, test/benchmark verification                      |

## Coder Routing

Use the strongest available coding model when any of these are true:

- The change crosses package boundaries (`core` + `db`, `desktop` + `renderer`, IPC + tests).
- The issue touches non-destructive file handling, migrations, worker orchestration, native
  modules, Electron packaging, Playwright, or benchmark gates.
- Prior attempts failed build/test/e2e/bench twice.
- The implementation requires balancing product behavior, architecture, and test strategy.

Use a faster coding model only when the change is clearly bounded:

- Documentation-only or prompt-only edits.
- Mechanical renames or formatting.
- Focused test additions where the production behavior is already implemented.
- One-file fixes with a known failing assertion and no architecture impact.

## Fallback Behavior

If the harness cannot use one of the preferred model names:

1. Use the strongest equivalent reasoning/coding model available.
2. If only Anthropic aliases are supported, use the frontmatter fallback:
   - `opus` for Orchestrator, Planner, Spec Writer, and high-risk Reviewer depth.
   - `sonnet` for Coder and Reviewer throughput.
3. If only OpenAI models are supported, map:
   - Orchestrator/Planner -> GPT-5.6 or GPT-5.5.
   - Spec Writer -> GPT-5.4.
   - Reviewer -> GPT-5.5.
   - Coder -> GPT-5.6 for complex work, GPT-5.5 for normal work, GPT-5.4 for small fixes.
