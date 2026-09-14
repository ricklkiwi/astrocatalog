# ADR-007: Falsifiability Is A Spec And Review Requirement

**Status:** Accepted
**Date:** 2026-09-14

## Context

Three times now this repo has shipped a test that could not fail, and each time the suite was green
when it happened.

`#111` (and `ADR-004` behind it): a DD-003 schema conformance test asserted
`expect(tables).toContain('sessions')` per table. The assertion is one-directional — it catches a
missing table and passes on an extra one. A schema deviation shipped and survived two months under
it, in a repo whose every schema defect to date has been something _added_ or _wrong_, never
something missing.

`#116` (the P1-13a app-shell slice): four blind checks in one spec. THM-6 asserted
`.app-root.contains(<nav>)` to prove `ThemeProvider` wraps `HashRouter` — it cannot, because
`HashRouter` renders no DOM element, so the containment relation is identical under either nesting
order. Swapping `App.tsx` to `<HashRouter><ThemeProvider>` left the assertion passing. NAV-12
queried a string nothing renders. NAV-7 used `.focus()`, which succeeds on `tabindex="-1"` whether
or not the element is keyboard-reachable. NAV-11 scoped a repo-wide rule to one file. All four
passed. All 931 tests passed.

`ADR-006` addressed the review-side symptom by ruling that a check which cannot fail is Major
regardless of the severity assigned to it, and is never deferred to backfill. That is a correct rule
and it is not enough, for two reasons the `#116` run exposed.

**The cause was upstream of the Coder.** THM-6 prescribed a _technique_ — assert this containment —
rather than a _property_. A prescribed technique inherits the spec's authority, and the Coder
implemented it faithfully, as it should have. The defect entered at the Spec Writer and every
downstream stage behaved correctly while propagating it. `#119` filed this observation and proposed
the fix; `ADR-006`'s alternatives section recorded it as complementary rather than rejected.

**The four were found by one specific act, which no prompt required.** The Reviewer mutated the
tests — swapped the nesting, and watched the assertion stay green. Nothing in
`reviewer.agent.md` asked for that. It said to read the changed files, check invariants, and run the
suite; a Reviewer following it exactly would have read THM-6, seen an assertion that looks like it
proves nesting, and marked the criterion ✓. That the blind checks were caught at all was a property
of that particular review, not of the procedure.

Both stages were, in other words, one careful reviewer away from shipping four known-blind tests
behind a green suite — and the procedure would have been followed correctly throughout.

## Decision

**Falsifiability is a requirement at two stages, not a habit at one.**

**The Spec Writer names the mutation.** Every mechanical criterion — one a test can check
automatically — carries a `**fails under:**` clause: one concrete edit to production source that
must turn it red. The mutation must edit production source rather than the test, must be a defect a
reasonable implementation could contain, and must be named precisely enough to apply without
guessing. A criterion the author cannot name a mutation for is not testable yet: it is either
sharpened until it is, or moved to an explicit **Judgement Criteria** block checked by inspection.
Alongside it, a general rule: state the property to be proven and let the implementer choose the
observable, rather than prescribing the observable yourself.

**The Reviewer runs the mutations.** A new Part 5 in `reviewer.agent.md`: from a green baseline,
apply each criterion's mutation, re-run the affected test file, confirm it fails _and that the
failure names the property_ — a crash or an unrelated assertion does not count — then restore and
confirm green. Every mechanical criterion gets a row in a Mutation Log in the report; no criterion
is ✓ without one. A test that survives its own mutation is a Major finding with its own report
shape.

This requires the Reviewer to edit application source, which its prompt otherwise forbids outright.
The prohibition is narrowed rather than dropped: the Reviewer may not **fix** application source,
and Part 5 mutations are the only application-source edits it makes, each reverted within the same
step, with `git status` clean before it reports.

The two halves are deliberately redundant. The Spec Writer's clause catches the defect at its source
and makes the Reviewer's job mechanical; the Reviewer's part still runs when the spec predates this
ADR or names no mutation, in which case it picks one and says so.

## Consequences

Reviews get slower again, on top of `ADR-006`'s duplication. Each mechanical criterion now costs an
edit, a scoped test run, a revert, and a confirming run. Running only the affected file rather than
the suite keeps this to seconds per criterion, and the `#116` spec's 105 criteria are an outlier
rather than a norm — but a large spec will make this the longest part of a review. That is the
intended trade: it is the only step that distinguishes a test from a test-shaped comment.

Spec writing gets harder in a way that is mostly good and occasionally annoying. Naming a mutation
forces the author to picture a concrete failing implementation, which is precisely the thinking that
THM-6 skipped. The annoyance is real for criteria that are genuinely about judgement — copy,
affordance, visual hierarchy — which is why **Judgement Criteria** exists as a first-class section
rather than a loophole. The risk is that it becomes a dumping ground; the prompt says to keep it
short, and a spec whose judgement list is longer than its mechanical one deserves a hard look.

Mutation is not proof. A criterion can be red under its one named mutation and still miss a
neighbouring defect — this is single-point mutation testing by hand, not a coverage guarantee, and
it should not be read as one. It rules out the specific failure this repo keeps having (a check that
cannot fail at all), not the general one (a check that misses something).

**The Coder's prompt is left alone, and that is now an inconsistency.** `orchestrator.agent.md`
already instructs the orchestrator to "reproduce a sample of claimed mutation evidence" from the
Coder, but `coder.agent.md` has never asked the Coder to produce any. The `#116` Coder did so
because it was told to in-run. Deciding whether mutation evidence is the Coder's duty or only the
Reviewer's is a separate question from this ADR and is left open rather than settled silently.

## Alternatives considered

**A mutation-testing tool (Stryker) in CI.** Genuinely better at what it does — exhaustive, and it
cannot be talked out of a mutant by plausible reasoning. Rejected for now on cost and fit: it is slow
enough to be a poor match for the per-PR gate the performance budgets already strain, its survivor
reports need human triage anyway, and it would not have caught THM-6, whose problem was that the
_criterion_ named an observable incapable of distinguishing the states — a mutant of `App.tsx`
nesting is not something Stryker generates. Worth revisiting for `packages/core`, where the logic is
pure and the runs are cheap.

**Reviewer-only enforcement, leaving the Spec Writer unchanged.** This is the status quo after
`ADR-006` plus a stronger Part 5. Rejected because it leaves the defect entering at the stage with
the most authority and catches it at the stage with the least room to fix it — the Reviewer cannot
edit application source, so a vacuous criterion becomes a round trip through the Coder rather than
never being written.

**Spec-Writer-only enforcement, trusting the clause.** Rejected: an unexecuted `fails under:` clause
is a claim, exactly like the unreproduced mutation evidence `ADR-006` warns about. The clause and its
execution are one mechanism split across two stages; either alone is decorative.
