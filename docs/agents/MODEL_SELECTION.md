# AstroTracker Agent Model Selection

Use this file as the model-routing policy for harnesses that can choose between OpenAI,
Anthropic, and other model families.

**In Claude Code, the `model:` line in each `.agent.md` frontmatter is the routing mechanism, not
a fallback.** A running agent cannot change its own model, so the preference lists below are
instructions for _operators_, not for agents — change routing by editing the frontmatter, then
record the change in `docs/adr/ADR-001-agent-harness-model-routing.md`. Agents no longer carry the
preference lists in their own prompts (see `ADR-003`).

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

## What The Frontmatter Currently Says

This table is the live state of `docs/agents/*.agent.md` — keep it in sync when you edit one.

| Role         | `model:` | `effort:` | Rationale                                                                           |
| ------------ | -------- | --------- | ----------------------------------------------------------------------------------- |
| Orchestrator | `opus`   | `high`    | Long-context coordination, dependency triage, disciplined handoff                   |
| Planner      | `fable`  | `high`    | Deep repo/design research, sequencing, risk identification                          |
| Spec Writer  | `opus`   | —         | Precise, verifiable criteria; ambiguity is expensive downstream                     |
| Coder        | `sonnet` | —         | Throughput on bounded, well-specified implementation steps                          |
| Reviewer     | `opus`   | `high`    | The only blocking gate before a PR; matches this file's Opus-over-Sonnet preference |

Claude Code accepts `opus`, `sonnet`, `haiku`, `fable`, `inherit`, or a full model id (e.g.
`claude-opus-5`). The `fable` alias resolves to Claude Fable 5.1 (`claude-fable-5-1`) — 1M context,
128K max output, billed at roughly twice Opus 5 per token — and is positioned for the most
demanding reasoning and long-horizon agentic work.

The Fable-first preference above is therefore honoured on the **Planner only**. The Planner is the
highest-leverage reasoning step in the pipeline: its job is the genuinely hard one (tracing data
paths, verifying external API shapes, finding edge cases), its output is the input to every other
agent, and it runs once per task on a bounded budget — so the premium is paid on a short,
high-value run, and a bad plan is the most expensive thing that can happen to a task.

The Orchestrator is long-horizon but not reasoning-hard: it mostly runs `gh`/`git` and delegates,
and it holds the longest context in the pipeline, so it is the worst place to pay a 2x token rate.
It stays on `opus`.

The alias is used rather than the pinned id so the Planner follows the current Fable generation. If
`fable` is not provisioned on the account, set the Planner back to `opus` — that is the only change
needed.

`effort:` (`low`/`medium`/`high`/`xhigh`/`max`) is a separate knob from model choice and is set on
the three roles whose failure mode is shallow analysis rather than slow output.

## Fallback Behavior

If the harness cannot use one of the preferred model names:

1. Use the strongest equivalent reasoning/coding model available.
2. If only Anthropic aliases are supported, use the frontmatter values in the table above.
3. If only OpenAI models are supported, map:
   - Orchestrator/Planner -> GPT-5.6 or GPT-5.5.
   - Spec Writer -> GPT-5.4.
   - Reviewer -> GPT-5.5.
   - Coder -> GPT-5.6 for complex work, GPT-5.5 for normal work, GPT-5.4 for small fixes.
