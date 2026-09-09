# ADR-003: Agent Frontmatter Is The Routing Mechanism; Prompts Carry No Model Policy

**Status:** Accepted
**Date:** 2026-09-07

## Context

`ADR-001` made agent prompts and model-routing policy repo artifacts, and treated the `model:`
field in each `.agent.md` frontmatter as "a compatibility fallback for Claude-style loaders". Each
of the five agent prompts therefore carried a 10–15 line **Model Selection** section restating the
role's preference list (`Fable 5 -> GPT-5.6 -> ...`).

Three problems followed from that framing:

1. **A running agent cannot choose its own model.** In Claude Code the model is fixed by the
   frontmatter or by the spawn call before the system prompt is ever read. The preference lists
   were addressed to a reader with no ability to act on them — roughly 60 lines of un-actionable
   text across five system prompts, paid for on every single agent invocation.
2. **The frontmatter drifted from the policy.** The orchestrator shipped `model: sonnet` while
   `MODEL_SELECTION.md` designated `opus` as its Anthropic fallback, and the reviewer shipped
   `model: sonnet` while the same file listed Opus ahead of Sonnet for that role. Because the
   frontmatter was framed as a mere "fallback", nobody treated the mismatch as a bug — but the
   frontmatter is what actually ran.
3. **The orchestrator injected model preferences into its subagent prompts**, where they were
   likewise inert. One of those injected lines had been spliced into the middle of a sentence in
   the Spec Writer handoff, corrupting the instruction itself.

Separately, `.claude/agents/*.md` declared `tools:` as a YAML array (`tools: [Read, Bash]`). The
documented Claude Code syntax is a comma-separated string; the array form is not the supported
shape. The tool sets were also wrong in ways that forced workarounds: the Planner and Spec Writer
were required to write `docs/plans/<slug>.md` and `docs/specs/<slug>.md` without the `Write` tool,
the orchestrator was required to rewrite links during archiving without `Edit`/`Write`, and no
agent had `Grep`/`Glob` despite every prompt instructing them to grep.

## Decision

**The frontmatter is the routing mechanism, not a fallback.** Model choice is an operator
decision expressed in `docs/agents/*.agent.md` frontmatter and documented in
`docs/agents/MODEL_SELECTION.md`. Agent prompts carry a four-line pointer to that policy and no
preference lists. The orchestrator's subagent handoffs carry task instructions only.

The preference lists in `ADR-001` and `MODEL_SELECTION.md` remain the policy of record for
harnesses that route dynamically. They are unchanged; only their audience is now explicit.

Frontmatter is brought in line with that policy and with the documented Claude Code schema:

| Role         | `model:` | `effort:` | `tools:`                                                                            |
| ------------ | -------- | --------- | ----------------------------------------------------------------------------------- |
| Orchestrator | `opus`   | `high`    | `Agent(planner, spec-writer, coder, reviewer), Read, Grep, Glob, Edit, Write, Bash` |
| Planner      | `fable`  | `high`    | `Read, Grep, Glob, Write, Edit, Bash, WebFetch, WebSearch`                          |
| Spec Writer  | `opus`   | —         | `Read, Grep, Glob, Write, Edit, Bash`                                               |
| Coder        | `sonnet` | —         | `Read, Grep, Glob, Edit, Write, Bash`                                               |
| Reviewer     | `opus`   | `high`    | `Read, Grep, Glob, Edit, Write, Bash`                                               |

The orchestrator's `Agent(...)` list is scoped to exactly its four pipeline subagents, so it
cannot spawn anything outside the fixed pipeline.

## Consequences

- Changing a role's model is a one-line frontmatter edit plus a note here — not a prompt rewrite.
- Roughly 60 lines of inert text leave five system prompts; the reviewer and planner spend that
  budget on analysis instead.
- The orchestrator (`sonnet` -> `opus`) and reviewer (`sonnet` -> `opus`) now run the model their
  own policy file already designated. This is a real cost increase, accepted because the reviewer
  is the only blocking gate before a PR and the orchestrator holds the longest context.
- `fable` is a supported Claude Code alias — it resolves to Claude Fable 5.1 (`claude-fable-5-1`),
  1M context, 128K max output, billed at roughly twice Opus 5 per token, and positioned for the
  most demanding reasoning and long-horizon agentic work. `MODEL_SELECTION.md` lists Fable first
  for both Orchestrator and Planner; we honour that on the **Planner only**.

  The Planner is the pipeline's one genuinely hard reasoning job (tracing data paths, verifying
  external API shapes, enumerating edge cases), its output is the input to all four downstream
  agents, and it runs once per task on a bounded budget — a short, high-leverage run where the
  premium is worth paying, and where a bad plan is the most expensive failure available. The
  Orchestrator is long-horizon but not reasoning-hard: it runs `gh`/`git` and delegates, and it
  carries the pipeline's longest context, making it the worst place to pay a 2x rate. It stays on
  `opus`.

  The alias is used rather than the pinned id so the Planner tracks the current Fable generation.
  If `fable` is not provisioned on the account, setting the Planner back to `opus` is the only
  change required.

- Prompts and frontmatter can now disagree only by oversight, not by design — `MODEL_SELECTION.md`
  carries a live table of what the frontmatter actually says.

## Update Rule

`ADR-001`'s update rule stands. Additionally: any change to a `model:`, `effort:`, or `tools:`
line must update the live table in `docs/agents/MODEL_SELECTION.md` in the same change.
