# Using AstroTracker's Agents And Skills

This is the practical companion to `docs/agents/*.agent.md`, `MODEL_SELECTION.md`, and
`docs/adr/ADR-001-agent-harness-model-routing.md` — read those for _why_ the agents are shaped the
way they are. This doc is about _how to actually invoke things_, in Claude Code today and in any
other harness later.

## The Five Project Agents

| Agent          | File                                | Job                                                                 | Writes to                         |
| -------------- | ----------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| `orchestrator` | `docs/agents/orchestrator.agent.md` | Claims a GitHub issue, drives the other four in order, opens the PR | Nothing itself — coordinates      |
| `planner`      | `docs/agents/planner.agent.md`      | Researches the codebase/design docs, writes an implementation plan  | `docs/plans/<slug>.md`            |
| `spec-writer`  | `docs/agents/spec-writer.agent.md`  | Turns the plan + issue into verifiable acceptance criteria          | `docs/specs/<slug>.md`            |
| `coder`        | `docs/agents/coder.agent.md`        | Implements exactly what the plan says                               | application source + tests        |
| `reviewer`     | `docs/agents/reviewer.agent.md`     | Checks the implementation against the spec, runs tests/benchmarks   | test files only, never app source |

They always run in this order: **orchestrator → planner → spec-writer → coder → reviewer**. Only
the orchestrator decides to start a new issue; the other four are always invoked _for_ a specific
plan/spec that already exists.

## Invoking Them In Claude Code

Once `docs/plans/agent-redirect-harness-agnostic.md` is executed, `.claude/agents/*.md` are
symlinks to the files above, so Claude Code discovers all five automatically as project subagents.

- **Start a new issue end-to-end:** ask Claude Code's top-level session to spawn the
  `orchestrator` subagent (e.g. "use the orchestrator agent to pick up the next eligible issue").
  It will spawn `planner`, `spec-writer`, `coder`, and `reviewer` itself via its own `Agent` tool
  access — you don't invoke those four directly in this flow.
- **Run one stage by hand** (e.g. you already have a plan and just want the coder to implement
  it): spawn that one subagent directly and point it at the specific plan/spec file, e.g. "use the
  coder agent to implement `docs/archive/tasks/p0-04-db-layer/plan.md`."
- **Check what Claude Code currently sees:** run `/agents` — all five should be listed with the
  descriptions from `docs/agents/*.agent.md`. If any description looks stale, the symlink is
  broken or was never created; see the plan doc's verification checklist.

## Invoking Them In A Different Harness

There is no equivalent of Claude Code's fixed `.claude/agents/` subagent loader in every harness.
If the harness you're using doesn't auto-discover subagents:

1. Read `AGENTS.md` at the repo root first — it's the harness-neutral entry point.
2. Open the relevant `docs/agents/<name>.agent.md` file directly and use its body as the system
   prompt / instructions for that turn.
3. Follow `docs/agents/MODEL_SELECTION.md` for which model to request, in preference order, for
   that role.
4. Since there may be no orchestrator-style delegation tool, run the pipeline by hand in the fixed
   order (planner → spec-writer → coder → reviewer), passing each stage's output file
   (`docs/plans/<slug>.md`, then `docs/specs/<slug>.md`) to the next.
5. The `tools:` frontmatter line in each `.agent.md` is Claude Code syntax and won't mean anything
   to another harness — read the prose body instead for what the role is and isn't allowed to
   touch (e.g. reviewer edits tests but never application source).

## Claude Code Skills That Complement These Agents

Skills are global/user-level Claude Code capabilities, not part of this repo — but several map
directly onto this pipeline and are worth reaching for alongside the project agents:

- **`/code-review`** — an independent second opinion on a diff; use after the `coder` agent
  finishes, in addition to (not instead of) the `reviewer` agent, since the reviewer checks
  spec/test conformance while `/code-review` checks correctness/simplification more generally.
- **`/verify`** — exercises a change end-to-end rather than just running tests; useful after
  `coder` for anything with runtime behavior (IPC, scanning pipeline, DB layer).
- **`/tdd`** — if you're picking up a `coder` task and want to work red-green-refactor instead of
  writing the implementation in one pass.
- **`/security-review`** — worth running before opening a PR for anything touching file
  handling, given the repo's non-destructive-guarantee hard rule in `CLAUDE.md`.
- **`/review`** — for reviewing an already-open GitHub PR (as opposed to `/code-review`, which
  reviews the current uncommitted diff).

None of these replace the five project agents — they're general-purpose checks you can layer on
top of any stage, most often after `coder` and before the `reviewer` agent or a PR.

## Task Document Archiving

`docs/plans/` and `docs/specs/` are active working folders. After the reviewer returns PASS for a
task, the orchestrator moves the completed plan and spec to `docs/archive/tasks/<slug>/`, updates
repo links to the archived paths, and records the task in `docs/archive/tasks/README.md`.

Do not keep completed task docs in the active folders just for reference. Reference completed work through the archive.

## Keeping This Working

- Edit agent behavior only in `docs/agents/<name>.agent.md`. Never edit under `.claude/agents/`
  directly — see `docs/adr/ADR-002-claude-agents-symlink-redirect.md`.
- If you change model routing, orchestration order, or what a role is allowed to touch, update
  the relevant ADR in `docs/adr/` in the same change (`ADR-001` for routing, `ADR-002` for the
  symlink mechanism itself).
