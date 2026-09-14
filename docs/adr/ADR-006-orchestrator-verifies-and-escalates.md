# ADR-006: The Orchestrator Is A Procedure That Verifies And Escalates, Not An Autonomous Entry Point

**Status:** Accepted
**Date:** 2026-09-14

## Context

`docs/agents/orchestrator.agent.md` described itself as the "entry point for all AstroTracker
development work" — an agent you spawn to take an issue from claim to PR without further
involvement. The first pipeline run after a seven-week stall (#92 → PR #116, the app-shell slice)
tested that description against reality and it did not hold up in three specific ways.

**The specialist agents were not routable.** The session had been launched from the directory
_above_ the repo, so `repo/.claude/agents/` was never scanned and none of `orchestrator`, `planner`,
`spec-writer`, `coder`, `reviewer` existed as a `subagent_type`. This is an environment condition,
not a defect in the agent files, and the obvious fix is to launch from the repo root. But it
surfaced that the pipeline had no documented fallback, and the run proceeded only because the stages
were spawned as `general-purpose` agents told to read their own role files, with `model` set from
each file's frontmatter per ADR-003.

**Two of the run's most consequential moments required a human, mid-pipeline.** The Planner found a
real conflict in DD-008: the document calls the per-filter colours "consistent" across themes, which
would put a pure-white swatch on an all-red night-vision screen and defeat that mode's purpose. It
correctly refused to deviate silently and raised it as an Open Question. The answer — that the mode's
purpose wins, and DD-008 itself must be amended in the same PR — was a design decision the pipeline
had no authority to make. The spec's scope (105 acceptance criteria expanded from the issue's four)
and the merge decision were likewise human calls. Step 2 already instructed the orchestrator to
"surface them to the user, and wait for answers," but a background subagent cannot wait: it blocks or
it guesses.

**Stage self-reports were not sufficient on their own.** Running the real gate rather than trusting
the Coder's summary caught a plan document committed unformatted, which the root `prettier --check .`
in `pnpm lint` — but not `pnpm -r lint` — would have failed in CI. Reproducing a sample of the
Coder's mutation evidence confirmed it was genuine. Checking the facts the plan rested on, before the
Coder built on them, confirmed the quoted DD-008 line matched the file byte-for-byte.

Most sharply, the Reviewer found a **Major that a green 931-test suite was hiding**: criterion THM-6
asserted `.app-root.contains(<nav>)` to prove `ThemeProvider` wraps `HashRouter`. It cannot —
`HashRouter` renders no DOM element, so the containment relation is identical under either nesting
order. Swapping the nesting left the assertion passing. Three further checks in the same slice were
vacuous for related reasons, and all four were found only because the Reviewer mutated the tests
themselves rather than reading them charitably. Under the severity ladder as written, every one of
them was a Minor, and Step 5 defers Minors to Step 8 — so following the procedure exactly would have
shipped four known-blind tests.

This is the same defect class ADR-004 and #111 are about: a DD-003 conformance test asserting
`expect(tables).toContain(...)`, which caught a missing table but passed on an extra one, letting a
schema deviation survive two months.

## Decision

**The orchestrator file is the procedure for driving one issue through the pipeline, followed either
by a spawned agent or by the session directly.** Running the stages in-session is a first-class use,
not a workaround. A spawned orchestrator suits a slice expected to be decision-free; anything
touching a DD, a spec's scope, or a merge is driven in-session, because those need an answer the
subagent cannot obtain.

Three additions to `orchestrator.agent.md`:

1. **Verify, don't relay.** The orchestrator runs the gate itself with the exact CI commands, notes
   that `pnpm lint` is not `pnpm -r lint`, reproduces a sample of claimed mutation evidence, checks
   the load-bearing facts a plan rests on before the Coder builds on them, and reads the three-dot
   diff rather than a summary.
2. **A check that cannot fail outranks its severity.** Any finding that a test cannot fail for its
   stated reason is Major and is fixed in-pipeline, whatever severity the Reviewer assigned. It is
   never deferred to backfill.
3. **Escalate, don't decide** — DD conflicts, material spec-scope changes, and the merge. A spawned
   subagent that cannot wait for an answer stops and reports instead of guessing.

Also recorded: check the E2E result explicitly before merging. `ci-ok` aggregates `[test, bench]`
only, so E2E is outside the required gate (#115) while being the sole real-watcher coverage on
Windows and on macOS CI (#113).

## Consequences

Pipeline runs get slower. The orchestrator now re-runs a full gate the Coder already ran and
reproduces mutations the Coder already performed, and that duplication is the point — it is what
separates a pipeline from a relay. The cost is minutes; the failure it prevents cost two months in
the ADR-004 case.

Fewer runs will be fully autonomous, which is an honest description of what the pipeline was already
doing rather than a new limitation. The DD-008 conflict in #116 would have required a human under any
framing; the previous wording simply did not say so.

The severity exception can be argued with. A blind check is not obviously "Major" in the ordinary
sense — nothing is broken for a user. It is classified that way because of this repo's specific
history: every schema and conformance defect found here has been something _added_ or _wrong_, never
something missing, and one-directional or vacuous checks are structurally blind to exactly that.

This does not make the orchestrator agent redundant. Its procedural content — archiving before the PR
so links point at final locations, the dependency-gating eligibility rule, the ADR-005 triage-label
boundary, and "never let findings disappear into chat" — is hard-won and was followed successfully
through #116. Only the claim of autonomy changes.

## Alternatives considered

**Delete the orchestrator agent and drive the pipeline manually every time.** Rejected: the file
encodes procedure a human driver would not reconstruct, and the archive-before-PR ordering in
particular is non-obvious and easy to get wrong.

**Keep it autonomous and have it post Open Questions to the issue, then halt.** This is close to what
Step 2 already said, and it remains available. It was not made the default because halting mid-run
leaves a branch, a claimed issue and an `in-progress` label in limbo until someone notices — whereas
an in-session driver simply asks.

**Require the Spec Writer to name the mutation each mechanical criterion must fail under.** Not
rejected — filed as #119. It attacks the same problem one stage earlier, and would have prevented
THM-6 at the source rather than catching it in review. The two are complementary.
