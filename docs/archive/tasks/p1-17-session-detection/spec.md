# Spec: [P1-17] Session detection algorithm

**Slug:** p1-17-session-detection **Issue:** #25 **Plan:** docs/archive/tasks/p1-17-session-detection/plan.md **Date:** 2026-09-13
**Governing DDs:** DD-006 (session detection rules), DD-003 (schema; amended in this PR — see DB-8/J-1), DD-002 (layering), ADR-004 (alter, never recreate), ADR-007 (falsifiability)

## Scope

One pure function `detectSessions(frames, config): SessionAssignment[]` in `packages/core/src/catalog/`, its two helpers (`resolveTimezone`/`astronomicalDayLabel`, `splitByGap`), a package-root export, and a plain `ALTER TABLE ADD COLUMN` migration adding four columns (`watch_folders.timezone`, `sessions.timezone`, `sessions.timezone_source`, `frames.session_assignment_locked`). No DB wiring, no UI — see **Out of Scope**.

Every criterion below is numbered so the Reviewer's Mutation Log can reference it. Each mechanical criterion names one edit to **production source** that must turn it red; the Reviewer applies each, confirms the failure names the criterion's property, then reverts.

Where a criterion's subject is a set (frame ids, object keys, column names), it must be asserted by **equality over the whole expected set**, not per-element containment — `#111` shipped a two-month schema deviation behind a one-directional `toContain`.

Concrete instants and expected labels for every scenario are in **Test Hints**; they are pre-computed and are the values the assertions must use.

## Definition of Done

### Functional Requirements

#### Public surface

- [ ] **API-1** — Given a consumer importing from `@astrotracker/core` (package root, no deep path), `detectSessions`, `SessionAssignment`, `SessionInputFrame`, `SessionDetectionConfig`, and `TimezoneSource` are all reachable — **fails under:** deleting `detectSessions` from the catalog export block in `packages/core/src/index.ts`.
- [ ] **API-2** — Given any scenario, every emitted assignment object carries exactly the key set `{sessionId, frameIds, sessionDate, timezone, timezoneSource, equipmentProfileId, startedAtUtc, endedAtUtc, isCalibrationOnly}` — no extra keys, none missing — **fails under:** omitting `timezoneSource` from the object literal emitted for unlocked runs in `packages/core/src/catalog/detect-sessions.ts`.
- [ ] **API-3** — Given a frames array in non-chronological order, when `detectSessions` returns, the caller's array and its element objects are unchanged (same order, same field values) — **fails under:** `splitByGap` in `packages/core/src/catalog/gap-splitting.ts` sorting its argument in place instead of sorting a copy.

#### Astronomical-day windowing (DD-006 noon-to-noon)

- [ ] **ALG-1** — Given a single-rig night whose frames run 20:00 local through 02:00 local across midnight (`America/Denver`, all consecutive gaps < 4 h), when detection runs, the result is exactly one assignment whose frame set equals the whole input and whose `sessionDate` is the evening-side date `'2026-07-05'` — **fails under:** `astronomicalDayLabel` in `packages/core/src/catalog/timezone.ts` labelling the instant's local calendar date without stepping pre-noon frames back one day (post-midnight frames then split into a second `'2026-07-06'` session).
- [ ] **ALG-2** — Given a frame at exactly local 12:00:00.000, its `sessionDate` is that same calendar date (noon opens the new astronomical day) — **fails under:** changing `NOON_HOUR` in `timezone.ts` from 12 to 13.
- [ ] **ALG-3** — Given a frame 1 ms before local noon (11:59:59.999), its `sessionDate` is the **previous** calendar date — **fails under:** changing `NOON_HOUR` in `timezone.ts` from 12 to 11.
- [ ] **ALG-4** — Given two frames on either side of a DST spring-forward discontinuity in the same night (`America/Denver`, 2026-03-08), both carry `sessionDate` `'2026-03-07'` and land in one assignment — **fails under:** `astronomicalDayLabel` applying a fixed numeric UTC offset captured once for the zone instead of reading the instant's local date and hour in the IANA zone. (The review-fix commit replaced the original shift-by-12-real-hours implementation, which was wrong on DST-transition days; ALG-4c–f in `timezone.test.ts` sit within an hour of local noon on both transition days so the named mutation can cross the boundary.)
- [ ] **ALG-5** — Given a morning frame in a fractional-offset zone (`Asia/Kolkata`, UTC+05:30), its `sessionDate` is the previous evening's date — **fails under:** `astronomicalDayLabel` computing the label from whole-hour offset arithmetic rather than the zone-aware formatted date.

#### Gap splitting (DD-006 "> 4 h", configurable)

- [ ] **ALG-6** — Given two same-night frames separated by exactly 4 h 00 m 00.000 s, the result is exactly one assignment containing both — **fails under:** changing the gap comparison in `splitByGap` from `>` to `>=`.
- [ ] **ALG-7** — Given the same pair separated by 4 h 00 m 00.001 s, the result is exactly two assignments whose frame sets are exactly `{first}` and `{second}` — **fails under:** `splitByGap` comparing whole hours (`Math.floor(deltaMs / 3_600_000) > gapHours`) instead of the raw millisecond delta.
- [ ] **ALG-8** — Given `config.gapHours = 2` and two same-night frames 3 h apart, the result is two assignments, while the identical input with `gapHours` omitted yields one — **fails under:** `detect-sessions.ts` passing the literal `4` to `splitByGap` instead of `config.gapHours ?? 4`.

#### Equipment splitting and bucketing

- [ ] **ALG-9** — Given one night of interleaved frames from two distinct `equipmentProfileId`s with no time gap, the result is exactly two assignments whose frame sets are exactly the two per-profile partitions — **fails under:** removing `equipmentProfileId` from the bucket key in `detect-sessions.ts`.
- [ ] **ALG-10** — Given one night where every frame has `equipmentProfileId: null` and no gap exceeds 4 h (the pre-P1-18 state), the result is exactly one assignment containing all of them — **fails under:** the bucket key in `detect-sessions.ts` falling back to the frame id when `equipmentProfileId` is null.
- [ ] **ALG-11** — Given that same all-null night, the emitted assignment's `equipmentProfileId` is `null` — **fails under:** `detect-sessions.ts` emitting the bucket key's no-profile sentinel (e.g. `'\0none'`) as the assignment's `equipmentProfileId`.
- [ ] **ALG-12** — Given a DSLR night mixing lights and flats on one rig with no gap > 4 h (no temperature data anywhere in the input), the result is exactly one assignment containing every frame — calibration frames shot during a night attach to that night's session (DD-006) — **fails under:** adding `frameType` to the bucket key in `detect-sessions.ts`.

#### Calibration-only sessions

- [ ] **ALG-13** — Given a night whose frames are all calibration types including at least one `darkflat`, the assignment's `isCalibrationOnly` is `true` — **fails under:** `detect-sessions.ts` deriving `isCalibrationOnly` from an explicit allow-list that omits `'darkflat'`.
- [ ] **ALG-14** — Given a night containing at least one `light` alongside calibration frames, the assignment's `isCalibrationOnly` is `false` — **fails under:** `detect-sessions.ts` computing `isCalibrationOnly` with `.some(f => f.frameType !== 'light')` instead of `.every(...)`.
- [ ] **ALG-15** — Given a night whose frames are all `unknown` type, `isCalibrationOnly` is `true` (the contract is "no member is a light", not "every member is a named calibration type") — **fails under:** `detect-sessions.ts` deriving `isCalibrationOnly` from an allow-list of the four calibration types (excluding `'unknown'`).

#### Boundary metadata and frame accounting

- [ ] **ALG-16** — Given a group's frames supplied in non-chronological input order, its `startedAtUtc`/`endedAtUtc` are the minimum and maximum `dateObsUtc` among its own frames — **fails under:** `detect-sessions.ts` taking `startedAtUtc`/`endedAtUtc` from the first and last elements of the group in input order.
- [ ] **ALG-17** — Given a frame whose `dateObsUtc` is `null` (unparseable DATE-OBS) mixed into an otherwise normal night, detection completes and that frame's id appears in no assignment's `frameIds` — **fails under:** removing the `dateObsUtc !== null` filter from the `usable` computation in `detect-sessions.ts` (the criterion is red whether the id surfaces in output or the run aborts on the null instant; either outcome violates the stated property).
- [ ] **ALG-18** — Given any scenario, the assignments **partition** the usable frames: the union of all `frameIds` equals exactly the set of input ids with non-null `dateObsUtc`, and no id appears in two assignments — **fails under:** `detect-sessions.ts` building locked groups from the full `usable` set instead of the locked partition, so locked frames are emitted twice.

#### Session identity across re-runs

- [ ] **ALG-19** — Given an unlocked group in which no member has a prior `existingSessionId`, the emitted `sessionId` is `null` (minting a row is the caller's job) — **fails under:** the id-selection helper in `detect-sessions.ts` falling back to `uuidv7()` or to a member frame's id instead of `null`.
- [ ] **ALG-20** — Given an unlocked run whose members carry two different non-null `existingSessionId`s in a 3-to-1 split, the emitted `sessionId` is the majority id, for both orderings of the input — **fails under:** the id-selection helper returning the earliest-`dateObsUtc` member's `existingSessionId` rather than the most frequent one.
- [ ] **ALG-21** — Given an unlocked run with a 1-to-1 tie between two non-null `existingSessionId`s, the emitted `sessionId` is the lexicographically smaller id, for both orderings of the input — **fails under:** the id-selection helper resolving a tie by first-encountered id instead of lexicographic comparison.
- [ ] **ALG-22** — Given the output of one run applied back onto a copy of its input (`existingSessionId`/`existingSessionTimezone`/`existingSessionTimezoneSource` set per assignment, ids minted where `sessionId` was `null`), a second run on the unchanged frame set produces the identical assignment set — same grouping, same `sessionId`s, same labels (DD-006 idempotent re-runs) — **fails under:** the id-selection helper in `detect-sessions.ts` always returning `null` instead of reusing a member's `existingSessionId`.

#### Timezone resolution (DD-006 site-vs-system, DD-003 stability)

- [ ] **TZ-1** — Given a frame at `2026-07-06T00:30:00Z` with `watchFolderTimezone: 'America/Denver'` and an unrelated `fallbackTimezone`, the assignment carries `sessionDate '2026-07-05'`, `timezone 'America/Denver'`, `timezoneSource 'watch_folder'` — **fails under:** `resolveTimezone` in `packages/core/src/catalog/timezone.ts` ignoring its `candidate` argument and always returning the fallback.
- [ ] **TZ-2** — Given the **same** instant with `watchFolderTimezone: null` and `fallbackTimezone: 'Pacific/Auckland'`, the assignment carries `sessionDate '2026-07-06'` — a different night than TZ-1 for a byte-identical instant — **fails under:** `astronomicalDayLabel` ignoring its `timezone` argument and formatting the shifted instant in UTC.
- [ ] **TZ-3** — Given that same fallback-resolved frame, its `timezone` is `'Pacific/Auckland'` and its `timezoneSource` is `'system_fallback'`, so a later UI can flag it as user-confirmable — **fails under:** `resolveTimezone` returning `'watch_folder'` as the source in both branches.
- [ ] **TZ-4** — Given a frame whose `watchFolderTimezone` is a non-IANA string (e.g. `'Mars/Olympus_Mons'`), detection completes without throwing and that frame resolves exactly as the `null` case does (fallback zone, `'system_fallback'`) — **fails under:** the IANA validity check in `timezone.ts` accepting any non-empty string (dropping the `Intl.DateTimeFormat` try/catch probe).
- [ ] **TZ-5** — Given `config.fallbackTimezone` is not a valid IANA zone, `detectSessions` throws, even when every frame carries a valid `watchFolderTimezone` and the fallback would never be consulted — **fails under:** deleting the `fallbackTimezone` validity guard at the top of `detectSessions`.
- [ ] **TZ-6** — Given a frame with `existingSessionId` set and `existingSessionTimezone 'America/Denver'` whose `watchFolderTimezone` has since been changed to `'UTC'`, the assignment's `timezone`, `timezoneSource`, **and** `sessionDate` are computed from the frozen `'America/Denver'` value (DD-003: grouping stays stable when settings change) — **fails under:** the per-frame timezone resolution in `detect-sessions.ts` consulting `watchFolderTimezone` before `existingSessionTimezone`.
- [ ] **TZ-7** — Given two locked frames sharing one `existingSessionId` but disagreeing on `existingSessionTimezone`, the group's `timezone`/`timezoneSource` are the earliest-`dateObsUtc` member's values, for both orderings of the input — **fails under:** `detect-sessions.ts` taking the first member in input order.

#### Manual-assignment locks (DD-006 "preserved via explicit assignment locks")

- [ ] **LOCK-1** — Given four frames all carrying `sessionAssignmentLocked: true` and `existingSessionId: 'session-A'` but separated by a > 4 h gap (a user merge of two auto-detected runs), the result contains exactly one assignment for `'session-A'` whose frame set equals all four — **fails under:** `detect-sessions.ts` running `splitByGap` over locked frames instead of exempting them.
- [ ] **LOCK-2** — Given four frames with no gap > 4 h, all `sessionAssignmentLocked: true`, split 2-2 across `'session-X'` and `'session-Y'` (a user split), the result reproduces exactly that two-way partition — **fails under:** the locked/unlocked partition predicate in `detect-sessions.ts` ignoring `sessionAssignmentLocked` and treating every frame as unlocked.
- [ ] **LOCK-3** — Given a locked group plus one **new, unlocked** frame whose `dateObsUtc` falls inside that group's start–end window on the same night and rig, the new frame is emitted as its own separate assignment and the locked group's frame set is exactly its own locked members (settled decision recorded on #25: a new frame never widens a lock; the worst case is an extra session beside the merged one) — **fails under:** `detect-sessions.ts` absorbing an unlocked frame into a locked group when its `dateObsUtc` lies within that group's `[startedAtUtc, endedAtUtc]`.
- [ ] **LOCK-4** — Given any locked group, its emitted `sessionId` is its members' `existingSessionId` verbatim, never `null` and never a different id — **fails under:** `sessionId,` → `sessionId: null,` in `buildLockedAssignment` in `packages/core/src/catalog/detect-sessions.ts`. (The originally-stated mutation — routing locked groups through the majority/tie-break id-selection helper — is an equivalent mutant: `lockedGroups` is keyed by `existingSessionId`, so that helper would return the same value by construction and the mutation would not turn the test red. ADR-007 requires a mutation a real implementation could contain.)
- [ ] **LOCK-5** — Given two locked frames sharing one `existingSessionId` but carrying **different** `equipmentProfileId`s, they remain one assignment (a lock is never re-evaluated against the equipment rule) — **fails under:** `detect-sessions.ts` bucketing locked frames by equipment profile before emitting them.
- [ ] **LOCK-6** — Given a frame with `sessionAssignmentLocked: true` but `existingSessionId: null` (a lock with nothing to lock to), it is grouped by the standard unlocked rules — it shares an assignment with its same-night, same-rig unlocked neighbours — **fails under:** the partition predicate in `detect-sessions.ts` keying on `sessionAssignmentLocked` alone, without also requiring a non-null `existingSessionId`.

### Data Integrity

- [ ] **DB-1** — After migrating a pre-0007 database, `watch_folders.timezone` exists as nullable TEXT and pre-existing rows read back `null` — **fails under:** deleting the `ALTER TABLE watch_folders ADD timezone` statement from `packages/db/drizzle/0007_*.sql`.
- [ ] **DB-2** — After the same migration, `sessions.timezone` exists as nullable TEXT and pre-existing rows read back `null` — **fails under:** deleting the `ALTER TABLE sessions ADD timezone` statement from `packages/db/drizzle/0007_*.sql`.
- [ ] **DB-3** — After the same migration, `sessions.timezone_source` exists as nullable TEXT and pre-existing rows read back `null` — **fails under:** deleting the `ALTER TABLE sessions ADD timezone_source` statement from `packages/db/drizzle/0007_*.sql`.
- [ ] **DB-4** — After the same migration, `frames.session_assignment_locked` exists as a NOT NULL boolean-valued column and **pre-existing rows read back `false`** — **fails under:** changing `DEFAULT 0` to `DEFAULT 1` in that ADD COLUMN statement in `packages/db/drizzle/0007_*.sql`.
- [ ] **DB-5** — For each of `watch_folders`, `sessions`, and `frames`, the migrated column-name set equals exactly the expected list (asserted by set equality, so an unsanctioned extra column fails the day it appears — `#111`) — **fails under:** appending `ALTER TABLE \`sessions\` ADD \`manually_locked\` integer DEFAULT 0;`to`packages/db/drizzle/0007_*.sql` (the session-level flag this slice explicitly does not add).
- [ ] **DB-6** — Writing and re-reading all four new fields through the existing repositories round-trips them unchanged, under their camelCase names, with the lock surfacing as a boolean rather than 0/1 — **fails under:** deleting the `timezoneSource` column declaration from `packages/db/src/schema/sessions.ts`.
- [ ] **DB-7** — Migrating a fixture database that already holds `watch_folders`, `sessions`, and `frames` rows preserves every pre-existing row (same ids, same column values) and completes without error; migrating an empty database to head also yields all four new columns — **fails under:** replacing the `sessions` ALTER statements in `packages/db/drizzle/0007_*.sql` with a drizzle table rebuild (`CREATE TABLE __new_sessions` … `DROP TABLE sessions` … `RENAME`), which ADR-004 forbids and which loses the seeded row.
- [ ] **DB-8** — The new migration is registered in `packages/db/drizzle/meta/_journal.json`, so a fresh install reaches head with all four columns — **fails under:** removing the 0007 entry from `packages/db/drizzle/meta/_journal.json`.

### Core Invariants

- [ ] **INV-1** — No code path in the diff writes, moves, renames, or deletes files outside the app-data directory — Reviewer greps the diff for fs write/rename/unlink calls; `packages/core/src/catalog/` must contain none at all, and the only writes in the diff are the migration's DDL against the app-data database.
- [ ] **INV-2** — All new domain logic is in `packages/core` with no Electron, no `fs`, no network imports, and no ambient environment reads: `packages/core/src/catalog/` contains no `process.env`, no `resolvedOptions(`, and no `Intl.DateTimeFormat` call without an explicit `timeZone` — Reviewer greps that directory and checks the import graph. The system timezone reaches the function only as `config.fallbackTimezone` (DD-002 rule 1).
- [ ] **INV-3** — All persisted/emitted timestamps are UTC instants: an assignment's `startedAtUtc`/`endedAtUtc` are equal to member `dateObsUtc` values, never re-derived from the local `sessionDate` label — **fails under:** `detect-sessions.ts` computing `startedAtUtc` as `new Date(sessionDate)`.
- [ ] **INV-4** — Manual session assignments survive a rescan: given a run's output applied back onto its input plus one newly scanned unlocked frame, every locked assignment's frame set is byte-identical to the previous run's — **fails under:** the locked/unlocked partition predicate in `detect-sessions.ts` ignoring `sessionAssignmentLocked`.
- [ ] **INV-5** — The three altered tables still satisfy DD-003's UUIDv7-TEXT-PK + `created_at`/`updated_at` conformance after migration — **fails under:** the 0007 migration rebuilding `sessions` without its `updated_at` column.
- [ ] **INV-6** — Long-running work through the worker queue: **N/A** — `detectSessions` is synchronous and pure; scheduling it is P1-18a's concern.

### Performance

**N/A for this slice, deliberately.** No wiring exists to run detection against a real catalog, so there is no path to benchmark and no `pnpm bench` case is added (the plan's Invariant Checklist flags this; P1-18a benchmarks the detect-and-persist path against PRD §8.4). The algorithmic-complexity expectation is carried as a judgement item (J-4), not a timing assertion — a wall-clock threshold on synthetic data would be flaky and would not be evidence about the real budget. The Reviewer must not flag the absence of a benchmark.

### Tests

- [ ] **TEST-1** — Table-driven unit tests cover, as distinct cases: midnight-spanning night; two-run night split by a > 4 h gap; multi-rig night; DSLR night with no temperature data; calibration-only night; the three timezone sub-cases (site tz, system fallback producing a different date, frozen tz beating a changed watch-folder tz); manual merge preserved; manual split preserved; idempotent re-run; majority/tie-break id selection; the exact-4 h and 4 h + 1 ms gap boundaries; and a `dateObsUtc: null` frame.
- [ ] **TEST-2** — Defensive edge cases from the plan are covered as tests: locked frame with a null `existingSessionId`; locked group whose `existingSessionTimezone` is absent (falls through to fresh resolution without throwing); locked group members disagreeing on the frozen timezone; malformed IANA string on a frame; invalid `config.fallbackTimezone`; an empty `frames` array returning `[]`.
- [ ] **TEST-3** — `splitByGap` and `astronomicalDayLabel`/`resolveTimezone` each have their own table-driven unit tests in addition to the orchestrator-level scenarios.
- [ ] **TEST-4** — The migration has a round-trip describe block mirroring the existing 0006 block (pre-0007 DB built via `buildPartialMigrationsFolder`, seeded, migrated, asserted).
- [ ] **TEST-5** — All existing tests still pass; `pnpm -r build`, `pnpm lint`, and `pnpm test` are each green (the exact commands CI runs — `-r lint`/`-r test` are not substitutes, per CLAUDE.md).
- [ ] **TEST-6** — E2E: **N/A** — this slice adds no UI surface and nothing reachable from the renderer. The merge/split-persists-across-rescan Playwright scenario belongs to P1-19, which owns the persistence and the Sessions page.
- [ ] **TEST-7** — TypeScript strict passes with no `any` lacking a `// justified:` comment in the diff.

## Judgement Criteria

- [ ] **J-1** — `design/DD-003-database-schema.md`'s SQL listing gains exactly two columns — `sessions.timezone_source` and `frames.session_assignment_locked` — and the diff **removes nothing**: `watch_folders.timezone` (line 26) and `sessions.timezone` (line 77), plus the "Timezone source" rationale (line 115), must survive untouched, because those two already exist in the DD and it is the code that was behind (ADR-004-class drift, not a DD change) — verified by the Reviewer inspecting the DD-003 diff.
- [ ] **J-2** — `SessionInputFrame` declares no temperature, quality, or other capture-metric field, so grouping structurally cannot depend on CCD-TEMP (the DSLR acceptance criterion's structural half; ALG-12 covers the behavioural half) — verified by the Reviewer inspecting `packages/core/src/catalog/types.ts`.
- [ ] **J-3** — Every statement in the new migration is a plain `ALTER TABLE ... ADD COLUMN` against an existing table: no `CREATE TABLE`, no `DROP TABLE`, no `__new_` rebuild, no `RENAME` (ADR-004) — verified by the Reviewer reading `packages/db/drizzle/0007_*.sql` end to end.
- [ ] **J-4** — `detectSessions` stays O(n log n): one sort per equipment/date bucket, hash-keyed bucketing, and no nested scan comparing every frame against every other frame or against every already-emitted assignment — verified by the Reviewer inspecting `packages/core/src/catalog/detect-sessions.ts` for nested loops over the full frame set.

## Out of Scope

The Reviewer must **not** flag any of the following as gaps:

- Wiring `detectSessions()` into the scan pipeline, the job queue, or any IPC handler — P1-18a (#125; originally assigned to P1-19, moved by #126).
- Persisting `SessionAssignment[]` into `sessions`/`frames.session_id`, the insert/update reconciliation, and the `UPDATE`-not-replace discipline that keeps `notes`/`weather_notes` alive across a reused session id — P1-18a.
- **The "merge/split persists across a rescan" E2E test** — it requires persistence and UI that do not exist yet; it is carried by P1-19's own acceptance criteria. LOCK-1/LOCK-2/INV-4 prove the algorithmic half here.
- The Sessions page, manual merge/split controls, and the session notes editor — P1-19/P1-23.
- The UI that confirms a `system_fallback` timezone with the user — a later Settings issue; this slice only produces the flag.
- `matchCalibration()` and all calibration matching — P1-20.
- `equipment_profiles` auto-detection — P1-18; `equipmentProfileId` is a given input here, including all-null.
- Settings UI for `watch_folders.timezone` or the gap-hours tolerance — later Settings issue.
- The multi-property "Site" entity (lat/lon, Bortle, `SITENAME`) — later Phase-1.x backlog; "site timezone" here is exactly `watch_folders.timezone`.
- A `sessions.manually_locked` or any session-row-level "manually adjusted" column — deliberately not added (DB-5 actively fails if one appears).
- A DB `CHECK` constraint on `sessions.timezone_source` — left application-enforced so the migration stays a plain `ALTER TABLE ADD`.
- New binary fixtures under `fixtures/` — tests use literal `SessionInputFrame` objects, matching the `packages/core/src/classification/*.test.ts` convention.
- Any benchmark or PRD §8.4 measurement — see the Performance section.
- Surfacing null-`dateObsUtc` frames for user review — a Review-Queue concern; this slice only excludes them.

## Test Hints

All instants pre-computed; `America/Denver` is MDT (UTC−6) in July and MST (UTC−7) before 2026-03-08T02:00 local.

- **Midnight-spanning night (ALG-1)**: frames at `2026-07-06T02:00Z`, `04:00Z`, `06:00Z`, `08:00Z` (local Denver 20:00, 22:00, 00:00, 02:00), one profile → one assignment, `sessionDate '2026-07-05'`, `startedAtUtc 2026-07-06T02:00Z`, `endedAtUtc 2026-07-06T08:00Z`.
- **DD-006's literal example**: a 01:30 local Jul 6 frame is `2026-07-06T07:30Z` → `sessionDate '2026-07-05'`.
- **Noon boundary (ALG-2/ALG-3)**: `2026-07-05T18:00:00.000Z` (local noon exactly) → `'2026-07-05'`; `2026-07-05T17:59:59.999Z` → `'2026-07-04'`.
- **DST (ALG-4)**: `2026-03-08T08:30Z` (01:30 MST, before the jump) and `2026-03-08T09:30Z` (03:30 MDT, after it) → both `'2026-03-07'`, one assignment.
- **Fractional offset (ALG-5)**: `2026-07-06T04:00Z` in `Asia/Kolkata` (local 09:30 Jul 6) → `'2026-07-05'`.
- **Gap boundary (ALG-6/ALG-7)**: `2026-07-06T02:00:00.000Z` + `2026-07-06T06:00:00.000Z` → one assignment; `2026-07-06T02:00:00.000Z` + `2026-07-06T06:00:00.001Z` → two. Both instants label `'2026-07-05'`, so any split is attributable to the gap rule alone.
- **gapHours override (ALG-8)**: `2026-07-06T02:00Z` + `2026-07-06T05:00Z`, `gapHours: 2` → two assignments; same input with `gapHours` omitted → one.
- **Timezone edge, three sub-cases**: instant `2026-07-06T00:30:00Z` with `watchFolderTimezone 'America/Denver'` → `'2026-07-05'`/`'watch_folder'`; same instant, `watchFolderTimezone: null`, `fallbackTimezone 'Pacific/Auckland'` → `'2026-07-06'`/`'system_fallback'`. For TZ-6 use instant `2026-07-05T13:00:00Z` with `existingSessionTimezone 'America/Denver'` and `watchFolderTimezone 'UTC'`: the frozen Denver value yields `'2026-07-04'` while a UTC re-derivation would yield `'2026-07-05'`, so the two are distinguishable (the `2026-07-06T00:30Z` instant is **not** — it labels `'2026-07-05'` under both zones and would make the assertion blind).
- **Manual merge (LOCK-1/LOCK-3)**: four frames at `2026-07-06T02:00Z`, `03:00Z`, `09:00Z`, `10:00Z` (a 6 h gap in the middle), all locked to `'session-A'` → one assignment for `'session-A'` with all four; add a new unlocked frame at `2026-07-06T06:00Z` (inside the old gap) → a second, separate assignment holding only that frame, and `'session-A'`'s `startedAtUtc`/`endedAtUtc` unchanged at `02:00Z`/`10:00Z`.
- **Manual split (LOCK-2)**: four frames one hour apart from `2026-07-06T02:00Z`, locked, first two `'session-X'`, last two `'session-Y'` → exactly two assignments with those ids and exactly those frame sets, even though the gap rule alone would merge all four.
- **Tie-break (ALG-21)**: one unlocked run, two frames with `existingSessionId` `'01890000-...-aaaa'` and `'01890000-...-bbbb'` → `'01890000-...-aaaa'` wins in both input orders.
- **Migration round-trip (DB-1…DB-7)**: build a pre-0007 DB with `buildPartialMigrationsFolder(dir, 6)`, seed one `watch_folders` row, one `sessions` row, and one `frames` row, migrate to head, then assert: seeded rows still present with their ids; `timezone`/`timezone_source` `null`; `session_assignment_locked` `false`; and the three tables' column-name sets equal to their expected lists.
